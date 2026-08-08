THE UNSHAKEN MAJORITY — INVESTIGATION API REPAIR

Purpose
-------
This repair restores every server endpoint used by the Investigations publishing system. It fixes the Vercel 404 at /api/investigations and prevents the same missing-function problem on the latest-investigation, detail, correction, evidence, and administrator endpoints.

Upload instructions
-------------------
1. Extract this ZIP.
2. In the existing GitHub repository, choose Add file > Upload files.
3. Drag EVERYTHING INSIDE this extracted folder into the repository root.
4. Confirm GitHub shows the api folder with all 16 JavaScript files, the server folder with 2 JavaScript files, plus investigation.html, package.json, and vercel.json.
5. Commit with: Restore all investigation API functions
6. Wait for the Vercel Production deployment to say Ready.
7. Test:
   https://www.theunshakenmajority.com/api/investigations?page=1&pageSize=9

Expected result when no investigation is published
--------------------------------------------------
A JSON response containing an empty items array, not a Vercel 404 page.

No Supabase tables, stored submissions, environment-variable values, brand assets, responsive banner files, or public page styling are changed by this repair.
