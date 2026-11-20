# Moving andriantam.com from DigitalOcean App Platform to Cloudflare Pages

Why: `dist/_redirects` works natively on Pages, so the old `/article/<id>` and `/portfolio/<id>` URLs get real 301s, and `www` can 301 to the apex. DigitalOcean App Platform ignores `_redirects`.

Expected downtime: none if you follow the order below. Do it on a quiet day, and allow 1-2 hours plus DNS propagation.

## What is on DNS today (checked 20 Nov 2026)

| Record | Value | Keep? |
|---|---|---|
| Apex `A` | DigitalOcean app addresses | Replaced by Pages |
| `www` `CNAME` | the app's `ondigitalocean.app` address | Replaced by Pages |
| Apex `TXT` | `google-site-verification=...` | **Yes. It verifies the Search Console property** |
| `MX`, `CAA`, `DS` (DNSSEC) | none found | n/a |

Open the DigitalOcean DNS panel and check for any other records (subdomains, other `TXT`). Cloudflare also scans the existing records when you add the site; compare its list against DigitalOcean's.

## Steps

1. **Pages project.** Cloudflare dashboard > Workers & Pages > Create > Pages > connect the GitHub repo. Build command `npm run build`, output `dist`. Add `NODE_VERSION=22` and the four API keys (see README) for Production. Deploy.
2. **Test on `*.pages.dev`.** Open the site, `/_redirects` should return 404 (Pages does not serve it), and `curl -sI https://<project>.pages.dev/photography` should return `301`. Pages URLs are safe from duplicate-content problems because every page's canonical tag points at `https://andriantam.com`.
3. **Add the site to Cloudflare** (free plan). Confirm the imported DNS records match DigitalOcean's, including the Google `TXT`.
4. **Add custom domains** in the Pages project: `andriantam.com` and `www.andriantam.com`. Cloudflare creates proxied CNAME records.
5. **Switch nameservers** at your domain registrar from `ns1/2/3.digitalocean.com` to the two Cloudflare nameservers shown in step 3. Do not enable DNSSEC until the switch has settled.
6. **Wait for the zone to turn Active** in Cloudflare (minutes to a few hours), then re-test the live domain.
7. **Redirect `www` to the apex.** Dashboard > Bulk Redirects: source `www.andriantam.com`, target `https://andriantam.com`, status 301, with subpath matching and path suffix preserved. Do the same for `<project>.pages.dev` to the apex.
8. **Retire DigitalOcean** only after a week of clean traffic: remove the domain from the App Platform app, then pause or delete the app.

## After the move

- Search Console: check Settings > Ownership still shows verified; Sitemaps still shows `sitemap-index.xml`; watch Pages and Crawl stats for new errors for two weeks.
- Fill `ANALYTICS.cloudflareToken` in `src/config/site.ts` to turn on Cloudflare Web Analytics.
- Confirm the daily GitHub rebuild triggers a Pages deploy.

## Rollback

Change the nameservers back to DigitalOcean's. The App Platform app keeps working until you delete it, which is why step 8 waits.
