# VIDYUTH VIKAS 2K26 - Admin Portal

Admin dashboard for `Technical Quiz` with 3 main tabs:

1. `Results`
- Latest attempt per roll number.
- Vertical list with expandable inline details (no page redirect).
- Fields shown: roll number, status, time taken, answered, unanswered, correct, wrong, score.
- Search by roll number.

2. `Score Card`
- Rank list with sorting logic:
  - `score` descending
  - tie-breaker: `timeTakenSeconds` ascending
  - if still tie: submit time ascending
- Columns: Rank, Roll Number, Score, Time Taken, Reason.

3. `Exam`
- Shows total active question count.
- Add/Edit/Delete questions.
- Question input includes: question text, options, image URL (optional), correct option.
- Question numbers auto-generated based on current active question list.

## Tech Stack

- Node.js + Express
- MongoDB Atlas (Mongoose)
- Vanilla HTML/CSS/JS frontend

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill values.

Example:

```env
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster-url>/exam_portal?retryWrites=true&w=majority
DB_NAME=exam_portal
PORT=5050
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EXAM_EDIT_LOCK=false
```

3. Start server:

```bash
npm start
```

4. Open browser:

```text
http://localhost:5050
```

## Collections Used

- `attempts` (reads candidate results)
- `questions` (admin-managed exam questions)

## Note

- `EXAM_EDIT_LOCK=true` will disable add/edit/delete question actions from Admin portal.

## Deploy On Render

Use Render so admin dashboard stays online even when your local machine is off.

1. Push `AdminPortal` project to GitHub.
2. In Render: `New +` -> `Web Service` -> connect that repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables in Render dashboard:

- `MONGO_URI` = your Atlas URI
- `DB_NAME` = `exam_portal`
- `ADMIN_USERNAME` = your admin username
- `ADMIN_PASSWORD` = your admin password
- `EXAM_EDIT_LOCK` = `false` (or `true` to lock question editing)

6. Deploy and open the Render URL.

Notes:

- `PORT` is provided by Render automatically; do not hardcode it there.
- In MongoDB Atlas Network Access, allow Render traffic (for quick setup you can test with `0.0.0.0/0`, then restrict later).
- `render.yaml` is included in this folder for blueprint-style deploy.
