# Deploying OneFlow

OneFlow runs as a single Render web service: Flask serves both the API and the built React app, and it stores data in Render Postgres. People sign in with Google, and each person gets their own private calendar.

You need to do three things once: create a Google sign-in client, deploy the Blueprint on Render, and then add your Render URL back in Google.

## 1. Create a Google sign-in client

1. Go to <https://console.cloud.google.com/> and create a project, for example "OneFlow".
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen) and set it up:
   - App name **OneFlow**, with your email as the support and contact email.
   - Audience: **External**.
   - Leave the scopes at the defaults. OneFlow only needs the basic `openid`, `email` and `profile` scopes.
3. Under **Clients**, click **Create client** and choose **Web application**. Under **Authorized JavaScript origins**, add:
   - `http://localhost`
   - `http://localhost:5173`

   Leave redirect URIs empty, because OneFlow doesn't use them.
4. Copy the **Client ID**, which looks like `1234-abc.apps.googleusercontent.com`. You don't need the client secret.
5. Under **Audience**, the app starts in **Testing**, where only the test users you add can sign in. To let anyone with a Google account join, click **Publish app**. Basic-scope apps don't need Google's verification review.

## 2. Deploy on Render

1. Sign in at <https://render.com> with GitHub, and give it access to the `oneflow` repo.
2. Go to **New → Blueprint**, pick the repo, and Render will read [`render.yaml`](render.yaml).
3. When prompted, fill in:
   - `GOOGLE_CLIENT_ID`: the client ID from step 1.
   - `OWNER_EMAIL`: your Google email. Any items in the database that don't belong to anyone yet are given to this account the first time it signs in.
4. Click **Apply**. The first build takes a few minutes. Render generates `SECRET_KEY` and creates the database and `DATABASE_URL` for you.
5. Open the URL Render gives you, for example `https://oneflow-xxxx.onrender.com`.

## 3. Add your Render URL in Google

Go back to the Google client from step 1 and add the Render URL, for example `https://oneflow-xxxx.onrender.com`, under **Authorized JavaScript origins**. Changes can take a few minutes to apply. After that, sign in on the live site.

Every push to `main` redeploys the site automatically.

## Free-plan limits (please read)

- **The free Postgres database expires 30 days after it's created.** After that you can't access it, and Render deletes it after a further 14-day grace period. Free databases also have no backups. To keep your data, upgrade the database to a paid plan in the Render dashboard before day 30.
- The free web service goes to sleep after 15 minutes without visitors. The next visit takes about a minute to wake it.
- Your local data in `instance/oneflow.db` is **not** copied to the hosted database.

## Local development

1. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...` (copy [`.env.example`](.env.example) if you don't have a `.env`).
2. Restart `python app.py` and keep `npm run dev` running in `frontend/`.
3. Sign in at <http://localhost:5173>. Your existing local items move to `OWNER_EMAIL`'s account the first time that account signs in.
