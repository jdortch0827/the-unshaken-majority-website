THE UNSHAKEN MAJORITY — VERCEL BUILD HOTFIX

This repairs the deployment error:
The pattern "api/investigation-page.js" defined in functions doesn't match any Serverless Functions inside the api directory.

Upload every item inside this extracted folder to the root of the existing GitHub repository.
Allow matching files to be replaced.

Commit message:
Fix missing investigation page function

This hotfix:
- restores api/investigation-page.js
- restores its HTML template and server dependencies
- simplifies the Vercel function configuration so one valid api/*.js pattern controls all functions
- preserves all existing routes, headers, and navigation rewrites
