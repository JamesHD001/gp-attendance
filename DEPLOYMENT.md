<!-- # Deployment to GitHub Pages

This guide walks you through deploying the YSA GP Attendance System to GitHub Pages.

## Prerequisites

- Git installed on your computer
- GitHub account
- YSA GP Attendance System code (already created)
- Firebase project with proper configuration

## Step-by-Step Deployment

### 1. Create GitHub Repository

1. Go to https://github.com/new
2. Fill in:
   - **Repository name**: `gp-attendance`
   - **Description**: `YSA GP Attendance System`
   - **Visibility**: Public (required for free GitHub Pages)
3. Do NOT initialize with README, .gitignore, or license
4. Click **Create repository**

### 2. Initialize Git in Your Project

Open terminal/command prompt and navigate to your project folder:

```bash
cd path/to/gp-attendance
git init
```

### 3. Add Remote Repository

Replace `YOUR_USERNAME` with your GitHub username:

```bash
git remote add origin https://github.com/YOUR_USERNAME/gp-attendance.git
```

Verify it was added:
```bash
git remote -v
```

### 4. Add All Files

```bash
git add .
```

### 5. Create First Commit

```bash
git commit -m "Initial commit: YSA GP Attendance System"
```

### 6. Push to GitHub

```bash
git branch -M main
git push -u origin main
```

### 7. Enable GitHub Pages

1. Go to your repository: `https://github.com/YOUR_USERNAME/gp-attendance`
2. Click **Settings** (top right)
3. Left sidebar → **Pages**
4. Under "Build and deployment":
   - **Source**: Select "Deploy from a branch"
   - **Branch**: Select "main"
   - **Folder**: Select "/ (root)"
5. Click **Save**

### 8. Wait for Deployment

GitHub will build and deploy your site. This takes 1-2 minutes.

You'll see a green checkmark when complete.

### 9. Access Your Site

Your site is live at:

```
https://YOUR_USERNAME.github.io/gp-attendance/
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Verify Deployment

1. Open your site URL in browser
2. You should see the login page
3. Try logging in with test credentials
4. Everything should work exactly like local version

## Updating Your Site

After making changes:

```bash
git add .
git commit -m "Description of changes"
git push
```

GitHub Pages will automatically redeploy within a few minutes.

## Custom Domain (Optional)

If you want to use a custom domain:

1. Settings → Pages
2. Under "Custom domain":
   - Enter your domain (e.g., `attendance.example.com`)
   - Click **Save**
3. Update your domain's DNS records:
   - CNAME record pointing to `YOUR_USERNAME.github.io`
   - Or use GitHub's A records (see their docs)

Wait 24 hours for DNS propagation.

## SSL Certificate (Automatic)

GitHub Pages automatically provides HTTPS with a free SSL certificate from Let's Encrypt.

It may take 5-10 minutes to activate after you enable Pages.

## Troubleshooting

### Site Not Loading / 404 Error

**Problem**: "This page can't be found"

**Solution**:
1. Check URL is correct: `https://YOUR_USERNAME.github.io/gp-attendance/`
2. Go to Settings → Pages → Check source is set to "main" and "/ (root)"
3. Check for red X next to Pages (build failed)
4. Check the build log in Actions tab

### App Not Working After Deploy

**Problem**: Blank page or JavaScript errors

**Solution**:
1. Open DevTools (F12) → Console tab
2. Look for error messages
3. Most common: Firebase config not updated
4. Verify `firebase-config.js` has real credentials
5. Commit and push the fix: `git add .` → `git commit` → `git push`

### Firebase Config Too Visible

**Problem**: "I exposed my Firebase credentials!"

**Solution** (if public repo):
1. Go to Firebase Console → Project Settings
2. Regenerate API key under "Web API key"
3. Old key is now invalid
4. Update `firebase-config.js` with new key
5. Push to GitHub

## Performance Tips

1. **Minification**: Optional - minify CSS/JS to reduce file size
2. **Caching**: GitHub Pages automatically caches assets
3. **CDN**: Content is served from GitHub's CDN (fast worldwide)

## Monitoring

Check deployment status:

1. Go to your GitHub repo
2. Click **Actions** tab
3. See all deployments and their status
4. Any build failures are shown here

## Rolling Back

If something breaks:

```bash
# See commit history
git log --oneline

# Revert to previous commit (replace COMMIT_ID)
git revert COMMIT_ID
git push
```

## GitHub Pages Limits

- **No server-side processing** - Everything is client-side (perfect for this app)
- **1 GB storage per repo** (usually plenty)
- **100 GB bandwidth per month** (plenty for typical usage)
- **Rate limits**: Not an issue for static sites

## Advanced: Custom Actions

GitHub can automatically build things for you. We don't need this since our code is already built, but it's available if you want to minify or process files.

See: https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#static-site-generation

## Keep Firebase Config Secure

### For Public Repos:

The API key in `firebase-config.js` is okay to expose because:
1. Firebase API keys are **not secrets** - they're meant to be public
2. Security is enforced by:
   - **Firestore Security Rules** (we provided these)
   - **Firebase Authentication** (only registered users)
   - **No admin SDK** in client code

### For Private Repos:

You still don't need to hide it, but you can use:
- Environment variables (with GitHub Secrets)
- Build-time injection
- Server-side rendering (but we don't have a server)

For this project, public Firebase key is fine and follows Google's recommended approach.

## Live Site Checklist

- [ ] GitHub repo created
- [ ] Code pushed to main branch
- [ ] GitHub Pages enabled
- [ ] Site accessible at correct URL
- [ ] Login page loads
- [ ] Can login with test credentials
- [ ] Admin dashboard displays
- [ ] Classes auto-initialize
- [ ] All features working

## Next Steps

1. **Share your url**: Give it to your YSA group
2. **Create more test users** in Firebase
3. **Assign instructors to classes** via admin dashboard
4. **Start tracking attendance**!

## Support

If something's not working:

1. Check browser console (F12)
2. Check GitHub Actions logs for deployment errors
3. Check Firebase Console for auth/Firestore issues
4. Review SETUP.md and README.md

---

**Quick URLs Reference**:
- Your Site: `https://YOUR_USERNAME.github.io/gp-attendance/`
- GitHub Repo: `https://github.com/YOUR_USERNAME/gp-attendance`
- GitHub Pages Settings: `https://github.com/YOUR_USERNAME/gp-attendance/settings/pages`
- Firebase Console: `https://console.firebase.google.com`

Happy deploying! 🚀 -->
