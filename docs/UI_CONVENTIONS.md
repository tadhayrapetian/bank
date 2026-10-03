# Ledgerhall — UI conventions

Ledgerhall is a working banking system that runs entirely in the browser. The
interface is a thin layer over the banking core: **every button performs a real
operation through a core service**, and every number on screen is read from the
database (IndexedDB via Dexie). There are no mock screens.

## Layers

| Layer | Path | Rule |
| --- | --- | --- |
| Domain types | `src/core/types.ts` | One source of truth for entities. |
| Database | `src/core/db/db.ts` | Dexie tables; `db.<table>` for reads in the UI. |
| Banking core | `src/core/banking/*` | Ledger, engine, accounts, payments, FX, cards, cash, checks, deposits, loans, investments, invoices, recurring, business, services (tax, insurance, disputes, KYC, vaults). |
| Documents | `src/core/docs/*` | Documents, seals, signatures, statements. |
| Ops | `src/core/ops/*` | Audit, search, analytics, scheduler, backup, admin, system status. |
| Security | `src/core/security/*` | Auth, permissions, fraud screening. |
| Comms | `src/core/comms/*` | Notifications, mail, messenger. |
| UI kit | `src/ui/*` | Design-system components. |
| Shell | `src/app/*` | Layout, navigation, palette, quick-action dialogs. |
| Features | `src/features/<module>/*` | One lazily loaded page per route. |

**The UI never writes to `db` directly.** Mutations always go through a core
service (they post ledger entries, write audit records, notifications,
documents and search data in one transaction). Reads use `useLive`.

The acting user is set by the session (`setActor`), so core services know who
is acting and check permissions themselves. Errors are `BankError` with a code
from `src/core/errors.ts`.

## Page skeleton

```tsx
/** One-line description of the page. */
import { useT, useFmt } from '@/hooks/useT';
import { useLive, useMe } from '@/hooks/data';
import { useAction } from '@/hooks/useAction';
import { db } from '@/core/db/db';
import { PageHead, Panel, Button, StatusBadge } from '@/ui/primitives';
import { DataTable } from '@/ui/DataTable';

export default function ThingsPage() {
  const { t, tx } = useT();
  const f = useFmt();
  const me = useMe();
  const { run, busy } = useAction();
  const rows = useLive(() => (me ? db.things.where('ownerId').equals(me.id).toArray() : []), [me?.id], []);
  return (
    <div className="page">
      <PageHead eyebrow={t('dept.TRS')} title={t('things.title')} sub={t('things.sub')} actions={<Button variant="primary" onClick={...}>{t('things.create')}</Button>} />
      <Panel title={t('things.list')} flush>
        <DataTable rows={rows} rowKey={(r) => r.id} rowLink={(r) => `/things/${r.id}`} columns={[...]} />
      </Panel>
    </div>
  );
}
```

* Pages are `default` exports in `src/features/<module>/<Name>Page.tsx`.
* Detail pages read `useParams()`; show an `Empty`/not-found state when the id is unknown.
* Staff-only pages wrap their content in `<Guard perm="…">` (`src/ui/Guard.tsx`).
* The page eyebrow names the responsible department (`t('dept.PAY')` etc.) —
  the "magical bureaucracy" is part of the design: case numbers, registry
  numbers, archive codes, seals and classifications appear wherever the data has them.

## Components (`src/ui`)

* `primitives.tsx`: `Button` (variant default|primary|ghost|danger, size sm|md|lg, `icon`, `loading`, `block`), `IconButton` (`label` required), `Panel` (`title`, `sub`, `icon`, `actions`, `footer`, `flush`, `ornate`, `paper`), `PageHead` (`eyebrow`, `title`, `sub`, `actions`), `Badge` (tone neutral|positive|negative|warning|info|magic), `StatusBadge` (`domain`, `status` — see `src/core/status.ts`), `DemoFlag`, `Field` (`label`, `hint`, `error`, `htmlFor`, `className="full"` spans the form grid), `Input`, `Select`, `Textarea`, `Switch` (`checked`, `onChange`, `label`), `Segmented`, `Tabs` (`tabs: {value,label,count?,icon?}[]`), `KV` (`items: [label, value][]`), `Stat` (`label`, `value`, `foot`), `Money` (`minor`, `ccy`, `sign`, `mask`, `tone`), `Empty` (`title`, `children`, `icon`, `action`), `Alert` (`tone`, `title`), `Progress`, `CodeTag`, `Avatar`, `Rule`, `Pager`.
* `DataTable.tsx`: sortable/paginated table, `rowLink`, `onRowClick`, `hideMobile`, `csvName`.
* `Modal.tsx`: `Modal` (`open`, `onClose`, `title`, `eyebrow`, `footer`, `size` wide|xwide) and `confirmAction({ title, body, confirmLabel, danger }) → Promise<boolean>` — **never** use `window.confirm/alert/prompt`.
* `Toasts.tsx`: `toast({ tone, title, body })`.
* `ErrorPanel.tsx`: explains a `BankError` (what happened, why, what to do).
* `charts.tsx`: `LineChart`, `BarChart`, `Donut`, `Sparkline`, `ChartFrame` (always give a table alternative), `Legend`. Series colours are `var(--s1)`…`var(--s8)`.
* `pickers.tsx`: `AccountPicker` (value is an encoded pocket `accountId::CCY`; `encodePocket/decodePocket`), `CurrencySelect`, `MoneyInput` (string value in major units).
* `BankCard.tsx`, `Seal.tsx`, `Signature.tsx` (`SignatureMark`, `SignaturePad`), `QR.tsx` (`QRCode`, `qrPayload`, `parseQrPayload`), `Barcode.tsx`, `Timeline.tsx` (`TxTimeline`), `DocumentPaper.tsx`, `heraldry.tsx` (`Crest`, `RuneSigil`, `Guilloche`).
* `print.ts`: `EMBED`, `printElement`, `exportPdf`, `downloadText`, `copyText`, `toCsv`.
* `sound.ts`: `play('payment' | 'error' | 'notify' | 'stamp' | 'safe' | 'card' | 'paper' | 'document')`.

## Hooks and state

* `useT()` → `t(key: TKey, params)` (typed keys) and `tx(dynamicKey, params, fallback)` for enum lookups such as `tx(\`status.card.${s}\`)`, `tx(\`txType.${type}\`)`.
* `useFmt()` → `money(minor, ccy, { sign, code, compact, mask })` (use `mask: true` for balances — the topbar can hide them), `date`, `dateLong`, `dateTime`, `time`, `month`, `rel(iso, nowMs)`, `num`, `pct`, `rate`, `inBase`.
* `useLive(fn, deps, fallback)` — reactive Dexie query.
* `useMe()`, `useMyAccounts()`, `useAccountsWithBalances(accounts)`, `useMyTransactions(limit, filter)`, `useNow(ms)`, `useUserMap()`.
* `useAction()` → `run(fn, { success, sound, silentError })`, `busy`, `error`. Show `error` with `<ErrorPanel error={error} />` inside forms.
* `useCan(permission)`; `useSession((s) => s.user)`.
* `useUI()` — `openAction('transfer' | 'receive' | 'exchange' | 'pay' | 'check' | 'openAccount' | 'deposit' | 'withdraw' | 'request' | 'scan' | 'document', params)` opens the global quick-action dialogs; `baseCurrency`, `lang`, `theme`.

## Money

Amounts are integers in **minor units** (`toMinor('12.50', 'EUR') → 1250`, `fromMinor`). Currency decimals come from the registry (`currencies.decimals(code)`); magical currencies are 4-letter codes (CRWN, MSLV, EMBR, RUNE, STAR, GRFN, VEIL, MIRE). Convert for display with `toBase(minor, ccy, base)` from `@/core/currency/rates`. Balances are **never** set directly — they come from the ledger (`balanceOf`, `pocketBalances`, the `balances` projection).

## Internationalisation

* No hard-coded user-visible strings. Every label is a dictionary key.
* English master dictionaries live in `src/i18n/en/…`; each feature group owns one file in `src/i18n/en/pages/<group>.ts` and the namespaces listed in its header. Reuse `common.*`, `status.*`, `txType.*`, `accountType.*`, `dept.*`, etc. from `src/i18n/en/core.ts` instead of duplicating.
* Russian and Armenian mirror the English files one-to-one: `src/i18n/ru/pages/<group>.ts`, `src/i18n/hy/pages/<group>.ts`. When a group is complete, type its mirror strictly — `export const growth: typeof Src = { … }` — so a missing key fails the type check.
* Interpolation: `{name}`; `{amount}` is formatted from `amt` (minor) + `ccy` params.
* Proper names of the fictional world (Aldermoor, Exchequer, Aetherline, SIGIL, currency names) are transliterated, not translated literally.

## Behaviour rules

* **No dead controls.** Every button, link, menu item and form does something real, or is disabled with an explanation (`title` or helper text). No "Coming soon", no TODO, no Lorem Ipsum.
* Destructive or irreversible operations ask `confirmAction` first.
* Long operations show progress; results show a receipt/timeline/link to the created record.
* Errors explain what happened, why, and what to do (`ErrorPanel`).
* Demo-only data is labelled: FX rates and charts, investment prices, fraud risk scores, tax calculations ("simulation, not tax advice"), insurance quotes, KYC (fictional documents only).
* `EMBED` (single-file preview build): hide print, PDF and file download/upload of backups; keep everything else working. Camera access is unavailable there; offer the image/paste alternatives.
* Accessibility: every icon-only button has `label`/`aria-label`; inputs have labels (`Field htmlFor`); tables have headers; keyboard reachable; focus visible.
* Responsive: layouts use `.grid.cols-2/3/4/main/side`, `.form-grid`, `.stack`, `.row` — they collapse on tablets/phones. Check widths 1440, 1024 and 390.

## Utility classes

Layout `page page-head grid cols-2 cols-3 cols-4 cols-main cols-side span-2 span-all stack stack-sm stack-lg row row-between row-nowrap grow center right form-grid inset rule`; text `eyebrow muted ink2 small xsmall tnum mono truncate nowrap pos neg warn-text sr-only`; widgets `panel ornate panel-paper list list-item (li-main li-title li-sub li-end) glyph (in|out|fail) chip code-tag kbd badge tone-* progress hero-figure stat qa quick-actions tabs segmented timeline skeleton`; animation `fade-up ink-in paper-in rune-glow sigil-spin`. Design tokens: `--bg --surface --surface-2 --surface-3 --paper --paper-ink --ink --ink-2 --muted --line --line-strong --accent --accent-soft --accent-2 --pos --neg --warn --info --magic --magic-soft --s1..--s8 --r-xs --r-sm --r-md --r-lg --r-pill --f-display --f-engraved --f-ui --f-mono --f-script --f-paper`. Feature styles go in `src/styles/features/<group>.css`.

## URL contract

Other parts of the system link to these addresses; pages must honour them:
`/accounts/:id`, `/transactions/:id`, `/payments?tab=requests|scheduled|links|templates|bulk&created=<code>`, `/pay/:code`, `/international?track=<txId>`, `/cards/:id`, `/cards?action=freeze`, `/checks/:id`, `/checks?tab=received`, `/documents/:id`, `/editor/:id`, `/verify?doc=<id>&code=<code>`, `/deposits/:id`, `/loans/:id`, `/invoices/:id`, `/disputes/:id`, `/business?tab=approvals`, `/messages?t=<ticketId>`, `/branches?id=<id>`, `/employees?id=<id>`, `/archive?id=<id>`, `/admin?section=users&id=<userId>`.

## Checking your work

* Type check: `npx tsc -p tsconfig.app.json --noEmit`.
* Core tests: `npx vitest run tests/core.test.ts`.
* Visual smoke test (dev server on :5173): `node scripts/shot.mjs --as Aurelia --routes /cards,/cards/<id> --out <dir> [--width 390] [--lang ru] [--full]` — prints console errors.
* Demo identities: clients Aurelia Thornwood (primary, ALD-C-104701) and others; staff Quill (teller), Holloway (manager), Fenwright (accountant), Morrow (compliance), Greymark (auditor), Vantress (admin). Passwords: clients `aldermoor`, staff `exchequer`; card PINs `1234`.
