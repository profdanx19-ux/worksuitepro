# worksuitepro

Product page and invoice request server for WorkSuite Pro.

## Run

```bash
npm run dev
```

Open http://localhost:3000.

Tools, prices, and page copy come from `content/tools.json`. Edit that file to change what the site sells. Set `forSale` to `true` and add a `price` when a tool should appear on its own in pricing and on the invoice form.

## Invoice requests

Each request is saved in `data/invoices.json` on the computer running the server. To also receive it by email, copy `.env.example` to `.env` and fill in the mailbox settings for `support@worksute-kit.online`. The password stays in `.env` and is not committed.
