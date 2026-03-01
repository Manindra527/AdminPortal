const path = require("path");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();
mongoose.set("bufferCommands", false);

const app = express();
app.disable("x-powered-by");

const CONFIG = {
  port: Number(process.env.PORT || "5050"),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/exam_portal",
  dbName: process.env.DB_NAME || "exam_portal",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  examEditLock: String(process.env.EXAM_EDIT_LOCK || "false").toLowerCase() === "true"
};

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const DASHBOARD_CACHE_TTL_MS = 15000;
const authTokens = new Map();
const dashboardCache = new Map();

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false }));

const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    isCorrect: { type: Boolean, required: true }
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    attemptId: String,
    rollNumber: String,
    status: String,
    examStartedAt: Date,
    examSubmittedAt: Date,
    durationSeconds: Number,
    timeTakenSeconds: Number,
    summary: {
      totalQuestions: Number,
      answered: Number,
      unanswered: Number,
      correct: Number,
      wrong: Number,
      score: Number,
      percentage: Number
    },
    answers: [mongoose.Schema.Types.Mixed],
    logs: [mongoose.Schema.Types.Mixed]
  },
  {
    strict: false,
    collection: "attempts"
  }
);

attemptSchema.index({ rollNumber: 1 });
attemptSchema.index({ examSubmittedAt: -1, createdAt: -1 });

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    question: { type: String, required: true },
    image: { type: String, default: null },
    options: {
      type: [optionSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length >= 2,
        message: "Minimum two options required."
      }
    },
    isActive: { type: Boolean, default: true }
  },
  {
    collection: "questions",
    timestamps: true
  }
);

questionSchema.index({ isActive: 1, createdAt: 1 });

const Attempt = mongoose.model("AdminAttempt", attemptSchema);
const Question = mongoose.model("AdminQuestion", questionSchema);

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, session] of authTokens.entries()) {
    if (session.expiresAt <= now) {
      authTokens.delete(token);
    }
  }
}

function requireAuth(req, res, next) {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  if (req.path === "/api/health" || req.path === "/api/auth/login") {
    return next();
  }

  cleanupExpiredTokens();
  const token = String(req.headers["x-admin-token"] || "").trim();
  const session = token ? authTokens.get(token) : null;
  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  req.adminUser = session.username;
  return next();
}

function requireExamEditEnabled(req, res, next) {
  if (CONFIG.examEditLock) {
    return res
      .status(423)
      .json({ ok: false, error: "Question edits are locked currently. Disable EXAM_EDIT_LOCK to edit." });
  }
  return next();
}

function normalizeQuestionPayload(payload, existingQuestionId = null) {
  const questionText = String(payload?.question || "").trim();
  const imageRaw = String(payload?.image || "").trim();
  const optionsInput = Array.isArray(payload?.options) ? payload.options : [];
  const correctOptionIndex = Number(payload?.correctOptionIndex);

  const optionTexts = optionsInput
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      return String(item?.text || "").trim();
    })
    .filter(Boolean);

  if (!questionText) {
    throw new Error("Question text is required.");
  }

  if (optionTexts.length < 2) {
    throw new Error("At least two options are required.");
  }

  if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= optionTexts.length) {
    throw new Error("Select a valid correct option.");
  }

  const questionId = existingQuestionId || `q-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const options = optionTexts.map((text, index) => ({
    id: `${questionId}-opt-${index + 1}`,
    text,
    isCorrect: index === correctOptionIndex
  }));

  return {
    id: questionId,
    question: questionText,
    image: imageRaw || null,
    options,
    isActive: true
  };
}

function mapQuestionDoc(item, questionNumber = null) {
  const options = Array.isArray(item.options)
    ? item.options.map((option) => ({
        id: option.id,
        text: option.text,
        isCorrect: Boolean(option.isCorrect)
      }))
    : [];

  return {
    _id: String(item._id),
    questionNumber,
    id: item.id,
    question: item.question,
    image: item.image || null,
    options,
    correctOptionIndex: Math.max(
      0,
      options.findIndex((option) => option.isCorrect)
    )
  };
}

async function fetchLatestAttemptPerRoll(searchText = "") {
  const pipeline = [];
  const search = String(searchText || "").trim();

  if (search) {
    pipeline.push({
      $match: {
        rollNumber: {
          $regex: search,
          $options: "i"
        }
      }
    });
  }

  pipeline.push(
    {
      $sort: {
        examSubmittedAt: -1,
        createdAt: -1
      }
    },
    {
      $group: {
        _id: "$rollNumber",
        doc: { $first: "$$ROOT" }
      }
    },
    {
      $replaceRoot: {
        newRoot: "$doc"
      }
    },
    {
      $project: {
        rollNumber: 1,
        status: 1,
        examSubmittedAt: 1,
        createdAt: 1,
        timeTakenSeconds: 1,
        summary: 1
      }
    }
  );

  const docs = await Attempt.aggregate(pipeline, { allowDiskUse: true });

  return docs.sort((a, b) => {
    const timeA = new Date(a.examSubmittedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.examSubmittedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
}

function buildDashboardPayload(rows) {
  const results = rows.map((item) => ({
    rollNumber: item.rollNumber || "-",
    status: item.status || "-",
    submittedAt: item.examSubmittedAt || item.createdAt || null,
    timeTakenSeconds: Number(item.timeTakenSeconds || 0),
    totalQuestions: Number(item.summary?.totalQuestions || 0),
    answered: Number(item.summary?.answered || 0),
    unanswered: Number(item.summary?.unanswered || 0),
    correct: Number(item.summary?.correct || 0),
    wrong: Number(item.summary?.wrong || 0),
    score: Number(item.summary?.score || 0)
  }));

  const sorted = [...rows].sort((a, b) => {
    const scoreA = Number(a.summary?.score || 0);
    const scoreB = Number(b.summary?.score || 0);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    const timeA = Number(a.timeTakenSeconds || Number.MAX_SAFE_INTEGER);
    const timeB = Number(b.timeTakenSeconds || Number.MAX_SAFE_INTEGER);
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    return 0;
  });

  const scorecard = [];
  let prevScore = null;
  let prevTime = null;
  let currentRank = 0;

  sorted.forEach((item, index) => {
    const score = Number(item.summary?.score || 0);
    const timeTakenSeconds = Number(item.timeTakenSeconds || 0);

    if (score !== prevScore || timeTakenSeconds !== prevTime) {
      currentRank = currentRank === 0 ? 1 : currentRank + 1;
      prevScore = score;
      prevTime = timeTakenSeconds;
    }

    scorecard.push({
      rank: currentRank,
      rollNumber: item.rollNumber || "-",
      score,
      timeTakenSeconds,
      reason: `Score ${score}, Time ${timeTakenSeconds}s`
    });
  });

  return {
    results,
    scorecard
  };
}

async function getDashboardData(search = "") {
  const cacheKey = String(search || "").trim().toLowerCase();
  const now = Date.now();
  const cached = dashboardCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const rows = await fetchLatestAttemptPerRoll(search);
  const payload = buildDashboardPayload(rows);
  dashboardCache.set(cacheKey, {
    expiresAt: now + DASHBOARD_CACHE_TTL_MS,
    payload
  });

  return payload;
}

app.use(requireAuth);

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "admin-portal" });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (username !== CONFIG.adminUsername || password !== CONFIG.adminPassword) {
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  }

  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  authTokens.set(token, { username, expiresAt });

  return res.json({
    ok: true,
    token,
    expiresAt
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (token) {
    authTokens.delete(token);
  }
  res.json({ ok: true });
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const payload = await getDashboardData(req.query.search);
    return res.json({
      ok: true,
      results: payload.results,
      scorecard: payload.scorecard
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/results", async (req, res) => {
  try {
    const payload = await getDashboardData(req.query.search);
    return res.json({ ok: true, count: payload.results.length, results: payload.results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/scorecard", async (req, res) => {
  try {
    const payload = await getDashboardData(req.query.search);
    return res.json({ ok: true, count: payload.scorecard.length, scorecard: payload.scorecard });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/exam/summary", async (_, res) => {
  try {
    const totalActiveQuestions = await Question.countDocuments({ isActive: true });
    return res.json({ ok: true, totalActiveQuestions });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/exam/questions", async (_, res) => {
  try {
    const questions = await Question.find({ isActive: true }).sort({ createdAt: 1 }).lean();
    const mapped = questions.map((item, index) => mapQuestionDoc(item, index + 1));
    return res.json({ ok: true, total: mapped.length, questions: mapped });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/exam/questions", requireExamEditEnabled, async (req, res) => {
  try {
    const normalized = normalizeQuestionPayload(req.body);
    const created = await Question.create(normalized);
    return res.status(201).json({ ok: true, question: mapQuestionDoc(created.toObject()) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.put("/api/exam/questions/:mongoId", requireExamEditEnabled, async (req, res) => {
  try {
    const mongoId = String(req.params.mongoId || "");
    const questionId = String(req.body?.questionId || "").trim();
    if (!questionId) {
      return res.status(400).json({ ok: false, error: "Question ID is required for update." });
    }

    const normalized = normalizeQuestionPayload(req.body, questionId);

    const updated = await Question.findOneAndUpdate(
      { _id: mongoId, isActive: true },
      {
        $set: {
          question: normalized.question,
          image: normalized.image,
          options: normalized.options
        }
      },
      {
        new: true,
        runValidators: true
      }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Question not found." });
    }

    return res.json({ ok: true, question: mapQuestionDoc(updated) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/exam/questions/:mongoId", requireExamEditEnabled, async (req, res) => {
  try {
    const mongoId = String(req.params.mongoId || "").trim();
    if (!mongoId) {
      return res.status(400).json({ ok: false, error: "Question ID is required." });
    }

    const selector = mongoose.isValidObjectId(mongoId)
      ? {
          $or: [{ _id: mongoId }, { id: mongoId }]
        }
      : { id: mongoId };

    const deleted = await Question.findOneAndDelete(selector).lean();

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Question not found." });
    }

    return res.json({ ok: true, deletedId: String(deleted._id) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/config", (_, res) => {
  res.json({ ok: true, examEditLock: CONFIG.examEditLock });
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ ok: false, error: "API route not found." });
  }
  return res.sendFile(path.join(publicDir, "index.html"));
});

async function start() {
  try {
    await mongoose.connect(CONFIG.mongoUri, {
      dbName: CONFIG.dbName,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 8000,
      maxPoolSize: 10,
      minPoolSize: 1
    });

    app.listen(CONFIG.port, () => {
      console.log(`Admin portal running at http://localhost:${CONFIG.port}`);
    });
  } catch (error) {
    console.error("Failed to start admin portal:", error.message);
    process.exit(1);
  }
}

start();



