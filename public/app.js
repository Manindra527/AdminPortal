const ui = {
  loginView: document.getElementById("loginView"),
  appView: document.getElementById("appView"),
  loginForm: document.getElementById("loginForm"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  tabs: Array.from(document.querySelectorAll(".tab-btn")),
  resultsTab: document.getElementById("resultsTab"),
  scorecardTab: document.getElementById("scorecardTab"),
  examTab: document.getElementById("examTab"),
  resultSearch: document.getElementById("resultSearch"),
  resultsList: document.getElementById("resultsList"),
  scoreTableBody: document.getElementById("scoreTableBody"),
  questionCount: document.getElementById("questionCount"),
  questionForm: document.getElementById("questionForm"),
  questionFormTitle: document.getElementById("questionFormTitle"),
  questionText: document.getElementById("questionText"),
  imageFile: document.getElementById("imageFile"),
  imagePreviewWrap: document.getElementById("imagePreviewWrap"),
  imagePreview: document.getElementById("imagePreview"),
  clearImageBtn: document.getElementById("clearImageBtn"),
  optionInputs: document.getElementById("optionInputs"),
  correctOption: document.getElementById("correctOption"),
  addOptionBtn: document.getElementById("addOptionBtn"),
  saveQuestionBtn: document.getElementById("saveQuestionBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  questionList: document.getElementById("questionList"),
  toast: document.getElementById("toast")
};

const state = {
  token: localStorage.getItem("admin_token") || "",
  activeTab: "results",
  resultSearch: "",
  allResults: [],
  results: [],
  scorecard: [],
  questions: [],
  editMongoId: null,
  editQuestionId: null,
  imageDataUrl: null,
  examEditLock: false,
  questionBusy: false
};

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
let resultSearchTimer = null;
let toastTimer = null;

function showToast(message, type = "success") {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${type}`;
  ui.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 2600);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function showLoginError(message) {
  ui.loginError.textContent = message;
  ui.loginError.classList.remove("hidden");
}

function clearLoginError() {
  ui.loginError.textContent = "";
  ui.loginError.classList.add("hidden");
}

function setViewLoggedIn(loggedIn) {
  if (loggedIn) {
    ui.loginView.classList.add("hidden");
    ui.appView.classList.remove("hidden");
  } else {
    ui.appView.classList.add("hidden");
    ui.loginView.classList.remove("hidden");
  }
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  ui.tabs.forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  ui.resultsTab.classList.toggle("hidden", tabName !== "results");
  ui.scorecardTab.classList.toggle("hidden", tabName !== "scorecard");
  ui.examTab.classList.toggle("hidden", tabName !== "exam");
}

function setImagePreview(imageDataUrl) {
  if (!imageDataUrl) {
    ui.imagePreview.removeAttribute("src");
    ui.imagePreviewWrap.classList.add("hidden");
    return;
  }

  ui.imagePreview.src = imageDataUrl;
  ui.imagePreviewWrap.classList.remove("hidden");
}

function clearImageSelection() {
  state.imageDataUrl = null;
  if (ui.imageFile) {
    ui.imageFile.value = "";
  }
  setImagePreview(null);
}

async function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unsupported image file."));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file) {
  const image = await fileToImageElement(file);
  const maxWidth = 1280;
  const maxHeight = 1280;
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Image processing failed.");
  }

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", 0.76);
}

function normalizeQuestionOrder() {
  state.questions = state.questions.map((item, index) => ({
    ...item,
    questionNumber: index + 1
  }));
}

function setQuestionBusy(busy) {
  state.questionBusy = busy;
  ui.saveQuestionBtn.disabled = busy || state.examEditLock;
  ui.cancelEditBtn.disabled = busy;
  ui.addOptionBtn.disabled = busy || state.examEditLock;
  ui.imageFile.disabled = busy || state.examEditLock;

  if (busy) {
    ui.saveQuestionBtn.textContent = state.editMongoId ? "Updating..." : "Saving...";
    return;
  }

  ui.saveQuestionBtn.textContent = "Save Question";
}

async function apiRequest(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers["x-admin-token"] = state.token;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({ ok: false, error: "Invalid server response." }));

  if (response.status === 401) {
    state.token = "";
    localStorage.removeItem("admin_token");
    setViewLoggedIn(false);
    throw new Error("Session expired. Please login again.");
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function renderResults() {
  ui.resultsList.innerHTML = "";

  if (state.results.length === 0) {
    ui.resultsList.innerHTML = '<div class="empty-state">No results found.</div>';
    return;
  }

  state.results.forEach((result, index) => {
    const item = document.createElement("article");
    item.className = "result-item";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "result-toggle";
    toggle.innerHTML = `
      <span><strong>${index + 1}. ${result.rollNumber}</strong></span>
      <span class="status-pill">${result.status}</span>
    `;

    const details = document.createElement("div");
    details.className = "result-details hidden";
    details.innerHTML = `
      <p>Submitted: <strong>${formatDate(result.submittedAt)}</strong></p>
      <p>Time Taken: <strong>${result.timeTakenSeconds}s</strong></p>
      <p>Total: <strong>${result.totalQuestions}</strong></p>
      <p>Answered: <strong>${result.answered}</strong></p>
      <p>Unanswered: <strong>${result.unanswered}</strong></p>
      <p>Correct: <strong>${result.correct}</strong></p>
      <p>Wrong: <strong>${result.wrong}</strong></p>
      <p>Score: <strong>${result.score}</strong></p>
    `;

    toggle.addEventListener("click", () => {
      details.classList.toggle("hidden");
    });

    item.appendChild(toggle);
    item.appendChild(details);
    ui.resultsList.appendChild(item);
  });
}

function renderScorecard() {
  ui.scoreTableBody.innerHTML = "";

  if (state.scorecard.length === 0) {
    ui.scoreTableBody.innerHTML = '<tr><td colspan="5">No score data available.</td></tr>';
    return;
  }

  state.scorecard.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.rank}</td>
      <td>${row.rollNumber}</td>
      <td>${row.score}</td>
      <td>${row.timeTakenSeconds}</td>
      <td>${row.reason}</td>
    `;
    ui.scoreTableBody.appendChild(tr);
  });
}

function createOptionInputRow(value = "") {
  const row = document.createElement("div");
  row.className = "option-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Option text";
  input.value = value;
  input.required = true;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-option-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    if (ui.optionInputs.children.length <= 2) {
      showToast("Minimum two options are required.", "error");
      return;
    }
    row.remove();
    refreshCorrectOptionSelector();
  });

  input.addEventListener("input", refreshCorrectOptionSelector);

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function refreshCorrectOptionSelector(selectedIndex = null) {
  const optionValues = Array.from(ui.optionInputs.querySelectorAll("input")).map((input) => input.value.trim());
  const previous = Number(ui.correctOption.value);
  ui.correctOption.innerHTML = "";

  optionValues.forEach((text, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = text ? `Option ${index + 1}: ${text}` : `Option ${index + 1}`;
    ui.correctOption.appendChild(option);
  });

  const target = Number.isInteger(selectedIndex)
    ? selectedIndex
    : Number.isInteger(previous)
      ? previous
      : 0;

  if (optionValues.length > 0) {
    ui.correctOption.value = String(Math.min(target, optionValues.length - 1));
  }
}

function resetQuestionForm() {
  state.editMongoId = null;
  state.editQuestionId = null;
  ui.questionFormTitle.textContent = "Add Question";
  ui.questionText.value = "";
  clearImageSelection();
  ui.optionInputs.innerHTML = "";
  ui.optionInputs.appendChild(createOptionInputRow());
  ui.optionInputs.appendChild(createOptionInputRow());
  refreshCorrectOptionSelector(0);
  ui.cancelEditBtn.classList.add("hidden");
}

function renderQuestions() {
  normalizeQuestionOrder();
  ui.questionCount.textContent = String(state.questions.length);
  ui.questionList.innerHTML = "";

  if (state.questions.length === 0) {
    ui.questionList.innerHTML = '<div class="empty-state">No questions added yet.</div>';
    return;
  }

  state.questions.forEach((question) => {
    const card = document.createElement("article");
    card.className = "question-card";

    const optionsHtml = question.options
      .map((option, index) => {
        const css = option.isCorrect ? "correct-option" : "";
        return `<li class="${css}">${index + 1}. ${option.text}</li>`;
      })
      .join("");

    const imageHtml = question.image ? `<img class="question-thumb" src="${question.image}" alt="Question image" />` : "";

    card.innerHTML = `
      <div class="question-card-head">
        <div>
          <h4>Q${question.questionNumber}. ${question.question}</h4>
          <p>ID: ${question.id}</p>
        </div>
        <div class="question-actions">
          <button type="button" class="edit-btn" data-id="${question._id}">Edit</button>
          <button type="button" class="delete-btn" data-id="${question._id}">Delete</button>
        </div>
      </div>
      ${imageHtml}
      <ul class="question-options">${optionsHtml}</ul>
    `;

    const editBtn = card.querySelector(".edit-btn");
    const deleteBtn = card.querySelector(".delete-btn");

    editBtn.disabled = state.examEditLock || state.questionBusy;
    deleteBtn.disabled = state.examEditLock || state.questionBusy;

    editBtn.addEventListener("click", () => {
      state.editMongoId = question._id;
      state.editQuestionId = question.id;
      state.imageDataUrl = question.image || null;
      ui.questionFormTitle.textContent = "Edit Question";
      ui.questionText.value = question.question;
      setImagePreview(state.imageDataUrl);
      if (ui.imageFile) {
        ui.imageFile.value = "";
      }
      ui.optionInputs.innerHTML = "";
      question.options.forEach((option) => {
        ui.optionInputs.appendChild(createOptionInputRow(option.text));
      });
      refreshCorrectOptionSelector(question.correctOptionIndex);
      ui.cancelEditBtn.classList.remove("hidden");
      ui.questionText.focus();
    });

    deleteBtn.addEventListener("click", async () => {
      if (state.questionBusy) {
        return;
      }

      setQuestionBusy(true);
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";

      try {
        const payload = await apiRequest(`/api/exam/questions/${question._id}`, {
          method: "DELETE"
        });

        state.questions = state.questions.filter((item) => item._id !== payload.deletedId);
        showToast("Question deleted.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        setQuestionBusy(false);
        renderQuestions();
      }
    });

    ui.questionList.appendChild(card);
  });
}
function applyResultsFilter() {
  const keyword = state.resultSearch.trim().toLowerCase();
  state.results = keyword
    ? state.allResults.filter((item) => String(item.rollNumber || "").toLowerCase().includes(keyword))
    : [...state.allResults];

  renderResults();
}

async function loadDashboardData() {
  const payload = await apiRequest("/api/dashboard");
  state.allResults = Array.isArray(payload.results) ? payload.results : [];
  state.scorecard = Array.isArray(payload.scorecard) ? payload.scorecard : [];

  applyResultsFilter();
  renderScorecard();
}

async function loadQuestions() {
  const payload = await apiRequest("/api/exam/questions");
  state.questions = payload.questions;
  renderQuestions();
}

async function loadConfig() {
  const payload = await apiRequest("/api/config");
  state.examEditLock = Boolean(payload.examEditLock);

  ui.questionForm.querySelectorAll("input, textarea, select, button").forEach((element) => {
    if (element.id === "cancelEditBtn") {
      return;
    }
    element.disabled = state.examEditLock;
  });

  if (state.examEditLock) {
    showToast("Question edits are currently locked by configuration.", "error");
  }
}

async function loadDashboard() {
  await Promise.all([loadConfig(), loadDashboardData(), loadQuestions()]);
}

function bindEvents() {
  ui.tabs.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  ui.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearLoginError();

    const username = String(document.getElementById("username").value || "").trim();
    const password = String(document.getElementById("password").value || "");

    try {
      const payload = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      state.token = payload.token;
      localStorage.setItem("admin_token", state.token);
      setViewLoggedIn(true);
      await loadDashboard();
      showToast("Logged in successfully.", "success");
    } catch (error) {
      showLoginError(error.message);
    }
  });

  ui.logoutBtn.addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (_) {
      // Ignore logout network error.
    }

    state.token = "";
    localStorage.removeItem("admin_token");
    setViewLoggedIn(false);
    clearLoginError();
    showToast("Logged out.", "success");
  });

  ui.resultSearch.addEventListener("input", () => {
    state.resultSearch = ui.resultSearch.value.trim();
    clearTimeout(resultSearchTimer);
    resultSearchTimer = setTimeout(() => {
      applyResultsFilter();
    }, 150);
  });

  ui.imageFile.addEventListener("change", async () => {
    const file = ui.imageFile.files && ui.imageFile.files[0] ? ui.imageFile.files[0] : null;
    if (!file) {
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      clearImageSelection();
      showToast("Please upload a valid image file.", "error");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      clearImageSelection();
      showToast("Image size must be below 2MB.", "error");
      return;
    }

    try {
      const dataUrl = await compressImageToDataUrl(file);
      state.imageDataUrl = dataUrl;
      setImagePreview(dataUrl);
      showToast("Image attached.", "success");
    } catch (error) {
      clearImageSelection();
      showToast(error.message, "error");
    }
  });

  ui.clearImageBtn.addEventListener("click", () => {
    clearImageSelection();
    showToast("Image removed.", "success");
  });

  ui.addOptionBtn.addEventListener("click", () => {
    ui.optionInputs.appendChild(createOptionInputRow());
    refreshCorrectOptionSelector();
  });

  ui.cancelEditBtn.addEventListener("click", () => {
    resetQuestionForm();
  });

  ui.questionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.questionBusy) {
      return;
    }

    const question = ui.questionText.value.trim();
    const options = Array.from(ui.optionInputs.querySelectorAll("input"))
      .map((input) => input.value.trim())
      .filter(Boolean);
    const correctOptionIndex = Number(ui.correctOption.value);

    if (!question) {
      showToast("Question text is required.", "error");
      return;
    }

    if (options.length < 2) {
      showToast("At least two options are required.", "error");
      return;
    }

    if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
      showToast("Select a valid correct option.", "error");
      return;
    }

    const payload = {
      question,
      image: state.imageDataUrl || null,
      options,
      correctOptionIndex
    };

    if (state.editQuestionId) {
      payload.questionId = state.editQuestionId;
    }

    setQuestionBusy(true);

    try {
      if (state.editMongoId) {
        const response = await apiRequest(`/api/exam/questions/${state.editMongoId}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });

        const index = state.questions.findIndex((item) => item._id === state.editMongoId);
        if (index >= 0) {
          state.questions[index] = response.question;
        }
        showToast("Question updated.", "success");
      } else {
        const response = await apiRequest("/api/exam/questions", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        state.questions.push(response.question);
        showToast("Question added.", "success");
      }

      resetQuestionForm();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setQuestionBusy(false);
      renderQuestions();
    }
  });
}

async function init() {
  bindEvents();
  resetQuestionForm();
  setQuestionBusy(false);

  if (!state.token) {
    setViewLoggedIn(false);
    return;
  }

  try {
    setViewLoggedIn(true);
    await loadDashboard();
  } catch (_) {
    state.token = "";
    localStorage.removeItem("admin_token");
    setViewLoggedIn(false);
  }
}

init();







