# SPAR Malta Hub — setup guide

This puts the hub and its tools at one web address with its own login.
It takes about 30–40 minutes the first time. Everything is free.

You'll create two free accounts, **GitHub** (hosts the website) and **Firebase**
(the login plus the database). Do the steps in order.

---

## 1. Create the Firebase project (login + database)

1. Go to **https://console.firebase.google.com** and sign in with a Google account.
   Use one the business can keep, not a personal account you might lose.
2. Click **Create a project** and name it `spar-malta-hub`.
3. When it asks about Google Analytics, switch it **off**, then click **Create project**.

### 1a. Turn on email + password login
1. In the left menu, open **Build → Authentication** and click **Get started**.
2. Under **Sign-in method**, click **Email/Password**, switch the first toggle **on** and click **Save**.

### 1b. Create the database
1. In the left menu, open **Build → Firestore Database** and click **Create database**.
2. For **Location**, choose **eur3 (europe-west)**. This can't be changed later.
3. Choose **Start in production mode** and click **Create**.

### 1c. Paste in the security rules
1. Still in Firestore, open the **Rules** tab.
2. Delete everything in the box. Paste in the whole contents of `firestore.rules` from this folder.
3. Click **Publish**.

---

## 2. Make yourself the first admin

The hub only lets in people on its access list. You have to add the first person, yourself, by hand:

1. Go to **Authentication → Users** and click **Add user**. Enter your email and a password, then click **Add user**.
2. Go to **Firestore Database → Data** and click **+ Start collection**.
   - Collection ID: `members` → **Next**
   - Document ID: your email, **all lower case** (for example `paul.kelly@spar.com.mt`)
   - Add a field `role` (string) = `admin`
   - Add a field `name` (string) = `Paul Kelly`
   - Click **Save**.

After this, you add everyone else from the hub's **Manage access** page. You won't need the console for that.

---

## 3. Connect the website to Firebase

1. In Firebase, click the **⚙ gear → Project settings**.
2. Under **Your apps**, click the **</>** (Web) icon. Nickname: `hub`. Leave "Firebase Hosting" **unticked**. Click **Register app**.
3. Firebase shows a block of code containing `const firebaseConfig = { apiKey: ..., ... }`.
4. Open `firebase-config.js` in this folder (Notepad or TextEdit is fine). Replace each placeholder value with the matching value from Firebase, keeping the quotes. Save.

> These values identify your project but aren't secret. The security comes from the login and the rules from step 1c.

---

## 4. Put the site on GitHub Pages

1. Go to **https://github.com/signup** and create a free account. Your username becomes part of the address (`yourname.github.io`).
2. Click **+ → New repository**.
   - Name: `spar-hub`
   - Choose **Public**. GitHub Pages is free for public repos. The page code is visible, but **no data is**: the data lives only in Firebase, behind the login.
   - Click **Create repository**.
3. On the new repo page, click **uploading an existing file**, then **choose your files**. Select **all the files** in this folder (Ctrl+A) and click **Open**. There are no subfolders. Click **Commit changes**.
4. Open **Settings → Pages**. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: main**, **folder: / (root)**, and click **Save**.
5. Wait 1–2 minutes and refresh. The page shows your address: **`https://yourname.github.io/spar-hub/`**

### 4a. Allow logins from that address
1. In Firebase, go to **Authentication → Settings → Authorized domains** and click **Add domain**.
2. Add `yourname.github.io` and click **Add**.

---

## 5. Try it

1. Open `https://yourname.github.io/spar-hub/` and sign in with the email and password from step 2.
2. You should see the hub. Click **Manage access** to add your colleagues.
   Each person gets an email with a link to set their own password. Tell them to check their junk folder.

**Access levels**
- **View only**: sees everything, changes nothing
- **Can edit**: uses the tools fully
- **Admin**: can edit, and also manages who has access

To remove someone, click **Remove** on the Manage access page. They're cut off immediately.

---

## 6. Moving the tools across

Each tool is one file named after it, for example `shop-tracker.html` or `cash-analyser.html`.
When Claude converts a tool, you get that one file back. Upload it to the repo
(**Add file → Upload files**) and it replaces the old one. It goes live in a minute or two.

**Existing data:** load the export file under **Manage access → Import saved data**.

## Making changes later

Ask Claude for the change and you'll get updated files back. Upload them to the repo as in step 4.3, over the old ones. Changes go live in a minute or two.

## Costs

Both free tiers cover a team this size many times over. Firebase only asks for a card if you choose to upgrade the plan. You don't need to.
