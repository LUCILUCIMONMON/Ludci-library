ambil:
npx wrangler d1 export lucimonlibrary --local --output backup.sql

kirim:
npx wrangler d1 execute lucimonlibrary --remote --file=backup.sql
