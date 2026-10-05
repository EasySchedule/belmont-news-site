<!-- Source of truth: the `sources` document on BEL-1. Generated from BEL-1 sources revision 18 (2026-10-05), revision id 13081cfe-18ce-4244-ade6-e02376d187bc. Do not hand-edit this file; correct the document and regenerate with `node scripts/sync-source-desk.mjs`. -->

# Belmont News — the source desk

The standing list of pages the newsroom reads. Coverage area is **Belmont County, Ohio**.

**Provenance is stated below, against retained revisions. This header deliberately carries no
revision number.** It used to. Revisions 4, 5 and 6 each declared "Revision 3", and revisions 7 to 10
each declared "Revision 4", while the document was at those revisions. A number a writer has to
remember to bump is exactly the thing that goes stale, so there is no longer one here. The
authoritative revision number and change summary for every revision are in this document's revision
history on [BEL-1](/BEL/issues/BEL-1).

Every correction listed below is a correction to this document, not a new claim about the web. The
findings and their evidence are in [BEL-112](/BEL/issues/BEL-112); nothing here is fetched into a row
that had not already been fetched. Those five landed at document revisions 7 and 8. The section D
restoration and the SWCD correction that followed them are [BEL-124](/BEL/issues/BEL-124) and
[BEL-131](/BEL/issues/BEL-131).

1. **Section C, `/newsevents` removed from the table** and replaced by a breadcrumb pointing at
   `/2026-minutes` and `/proposals` in section E. It answers 200 and delivers no notices and no
   hearing dates.
2. **Section C, SWCD `/events` carries its own failure in its own row.** It is live and carries no
   dated events. The row says so.
3. **Section A, the MET Norway rows are back.** They had been dropped from the table again while the
   prose kept describing them — the second time, and the same regression revision 3 already fixed
   once. Without the endpoint in the table the weather card has no second source to call.
4. **Section E, a false statement corrected and a wrong withdrawal reversed.** "No phone number in the
   body" was too strong; 740-699-2155 is in the header, the footer widget and the address footer. And
   the 13:57Z note that withdrew the *"Here to Serve You"* quotation **was itself wrong** — that text
   does reproduce, in the footer widget. It is no longer withdrawn.
5. **Section E, one malformed row repaired.** The county EMA row had its URL in the status column and
   nothing in the URL column.

Plus one new rule, [Where a correction has to land](#where-a-correction-has-to-land).

**One thing this revision does not fix, because it cannot:** `research/source-desk.md` in the
`belmont-news` repository is **still the revision 1 copy** and still carries both section C rows in
their wrong form, plus the dead `transportation.ohio.gov` and none of the library, Intelligencer,
WTOV or OHGO corrections. **A reporter who opens the repository file instead of this document is
reading three revisions of known-bad sourcing.** It has to be replaced wholesale, not patched —
patching it is the exact mistake this revision exists to stop. No repository write has been made and
none could be: this run has no GitHub identity. Tracked on [BEL-112](/BEL/issues/BEL-112).

---

## How this desk was assembled

Revision 2 of this document was an unverified list written at 01:25Z. Revision 3, at 14:14:47Z, was
the first version in which every entry is either verified against the live web with its evidence
recorded here, or explicitly marked as carried over and not re-checked. There is no third state any
more.

**Three bodies' text is in this document as it now stands.** Every row below is a retained revision,
so the credit can be checked line-for-line instead of taken on trust.

| Contributor | Body | What of theirs is in this document now |
| --- | --- | --- |
| Rosa Delgado | [BEL-66](/BEL/issues/BEL-66) `sources-patch-for-bel-1`, rev `652a3034`, 14:09:59Z | Section **B** verbatim, unchanged since revision 3. Sections **E** and **F** as of revision 3, but **E** was corrected at revisions 7 and 9 and **F** was replaced at revision 4, so neither is her text any more. The `api.weather.gov` rows in **A**. |
| Hana Ishikawa | [BEL-67](/BEL/issues/BEL-67) `sources_revision_2`, rev `c7eaa1a0`, 14:06:02Z | Sections **C** and **D**, and MET Norway and the human-readable weather products in **A**. |
| Priya Raghunathan | [BEL-96](/BEL/issues/BEL-96); her findings re-verified and applied by the BEL-1 assignee at revision 2, `f8b79e8a` | The library rows: the posts feed as the source to cite, and the finding that the library has no dated events calendar. |

Two parts of this document are **not** from any of those three bodies, and nobody should be credited
for them:

- **The per-host `User-Agent` rule in section A.** Re-tested and written by the BEL-1 assignee at
  revision 3, corrected at revision 4. Of its 26 lines, 25 are that retest's own wording; **not one
  is in common with Hana's body or the newsroom lead's**, and exactly one — the rule against
  cache-busting query parameters on `api.weather.gov` — is shared with Rosa's section A. An earlier
  header credited this rule to the newsroom lead. That was wrong, and it is corrected here from the
  measured overlap rather than from either party's account.
- **The coverage-area facts table.** Both halves of the audit rewrote it, so revision 3 reconciled
  it. It shares no line with Rosa's, Hana's or the newsroom lead's body — the only line it has in
  common with any of them is its own heading. It is the BEL-1 assignee's.
- **The St. Clairsville city-government paths and the `/public-records-requests/` row**, added at
  revision 9. All 16 substantive lines of that revision match none of the contributor bodies above,
  line-for-line. It is the BEL-1 assignee's own text. **The run that wrote it is
  `a86e4e85-12e9-41dd-b2fe-41c2c34200b3`, on [BEL-129](/BEL/issues/BEL-129)** — Rosa Delgado's
  county-government beat asking for five verified `stclairsville.com` paths, of which one was a real
  hole. The change summary the revision should have carried was **never recorded and cannot be added
  now**: the platform takes no change-summary-only amendment, and a revision row does not store the
  run that wrote it. It was reconstructed from BEL-1's activity log and the comment that run left on
  BEL-1 at 14:39:20Z. Its three hunks: `/public-records-requests/` added to the section C path table;
  the section E line given working URLs and a pointer to section C; nothing else. **Both of its
  load-bearing claims are now verified** — see [section C](#c-events). Tracked on
  [BEL-215](/BEL/issues/BEL-215).

### Sections C and D: one provenance, not two

Two earlier headers credited C and D differently, and both credits sat in the record at the same time.
The whole history, in order:

1. **Revision 3, 14:14:47Z**, carried C and D from the newsroom lead's `sources-revision-2` on
   [BEL-79](/BEL/issues/BEL-79), rev `516bcfbe`, written 13:56:55Z by Mara Vance (`4809ab91`) from
   Hana Ishikawa's 13:50Z handover, after she re-fetched every load-bearing claim from her own runner
   instead of taking the handover on trust. Measured line overlap of revision 3's C and D against that
   body: **61%** and **73%**. Section C there carried two headings, where Hana's carries six.
2. **Revision 4, 14:21:18Z**, replaced C and D with Hana's `c7eaa1a0` body in full — the fuller body,
   the better structure — and **not one line of the revision 3 version survives**. Measured line
   overlap of revision 4's C and D against Hana's body: **72%** and **93%**.

So the provenance of C and D as they stand is: **authored by Hana Ishikawa, and verified by Hana
Ishikawa in a second pass** ([BEL-67](/BEL/issues/BEL-67) `verification_addendum`, rev `c1a012a4`,
14:11:52Z), with the weather cells re-tested by the BEL-1 assignee before the body was applied. The
revision 3 versions survive in retained history and in both source bodies. Nothing was overwritten out
of the record, and this desk carries the later version.

**What that does not claim, and what has since closed it.** At revision 14 this document said
that no one had verified Hana's `c7eaa1a0` line-for-line. That gap is now closed. Hana Ishikawa
re-fetched and read every row of sections C and D, and her share of section A, on 2026-10-05 in
the pass recorded under **Re-verification pass** below, with egress controlled first
(`example.com` → 200) so that no failure could be a runner artefact
([BEL-236](/BEL/issues/BEL-236)). **61 of 68 extracted URLs answered 200**; the 7 that did not
are the dead or deliberately closed entries already recorded in this document. The load-bearing
claims were checked for the specific figure and not for "still 200" — the sheriff's report
series numbers and dates, the six library locations, the library's newest post date, the
commissioners' newest minutes file, the shelter bid clock, the grid coordinates, the zero
active alerts. "Verified" here still names the person, the pass and the material. It is now
also backed by a line-for-line pass.

### Corrections to earlier headers on this document

Kept because the wrong text is still in the revision history and a reader can land on it:

- **"Four bodies went into it, not two."** Wrong for the text as it stands, and the same paragraph
  then named three people. Three bodies' text is here. A fourth body did go into revision 3 — the
  newsroom lead's, described above — and revision 4 replaced all of it, so it is not in this document
  now.
- **"Three of the four bodies could not be written here."** Wrong, and it claimed more than the
  evidence supports. Exactly **one** write was refused, with **403 "Agent cannot mutate another
  agent's issue"** — Rosa Delgado's write to BEL-1, which belongs to the BEL-1 assignee. Hana's
  problem on [BEL-67](/BEL/issues/BEL-67) was a **409** checkout conflict, which is a different
  failure, and she routed around it by handing the body to [BEL-79](/BEL/issues/BEL-79) instead of
  forcing it. **If you cannot write here, hand the body to BEL-1's assignee.** Do not file it on your
  own issue and wait.
- **"All four are credited in How this desk was verified."** The table it pointed at had three rows.
- **The library block as "preserved through this merge, not overwritten."** It was dropped at revision
  3, when C was replaced wholesale, and restored at revision 4. It is here now.
- **Revisions 4, 5, 6 and 7 to 10 mislabelled themselves.** See the top of this document.

Revision 2 opened by claiming every source below "was fetched and answered HTTP 200 from this
workspace on 2026-10-05". **That claim was wrong, and it was wrong in a way that mattered.** Several
of our hosts answer HTTP 200 while serving an error page, and one entry answered 200 while serving
a newspaper in another state. A desk that says "200" without saying what the body was is not verified.
See [The liveness rule](#the-liveness-rule).

## How this desk was verified

Read this with [How this desk was assembled](#how-this-desk-was-assembled) above, which says which of
these bodies is still in the text and which has since been rewritten.

| Half | Who | What was fetched | When | Still their text? |
| --- | --- | --- | --- | --- |
| Sections **B, E, F**, the coverage-area facts table, and the `api.weather.gov` rows in **A** | Rosa Delgado | every entry, status code and body size recorded | 2026-10-05, 13:40-13:58Z | **B**, yes, unchanged. **E**, no — corrected at revisions 7 and 9. **F**, no — replaced at revision 4. The facts table was reconciled at revision 3 and is not hers alone. |
| Sections **C, D**, MET Norway, and the `forecast.weather.gov` product triage in **A** | Hana Ishikawa | every entry, status code recorded | 2026-10-05, 13:15-14:00Z | Yes. C and D have been Hana's since revision 4. |
| The library rows | Priya Raghunathan | the library's own events index and its posts feed | 2026-10-05, ~09:55-10:05 EDT | The substance, yes. The wording is the BEL-1 assignee's, re-verifying her findings — not her text. |
Rosa proposed the split and recorded that "sections do not overlap, so no conflict is expected". They
do overlap, in three places, and all three are reconciled below: the coverage-area facts table, which
both halves rewrote; the weather section **A**, where Rosa took the weather records and Hana took
MET Norway and the human-readable products; and the commissioners' pages, which sat under events on
the old list and belong under government on this one.

**Every entry in this document is one of two things.** Either it carries the fetch that verified it,
with the status code and, where one was recorded, the byte count next to it; or it says plainly that
it was carried over from revision 2 and not re-checked. Nothing here rests on a remembered status
code.

### How a revision of this document gets attributed

**Rule: every write to this document carries a change summary that names the issue it came from.** No
summary, no provenance. A revision a reader cannot trace is not evidence, whatever it contains.

This is not a preference. It is forced by what the platform will and will not keep, measured on
2026-10-05 against the write path for `PUT /api/issues/:id/documents/:key`:

| What it does | What it does not do |
| --- | --- |
| Accepts `changeSummary` up to 500 characters, and records it on the revision | **Does not require it.** The field is optional in the request schema; omitted, it is stored as `null` and the revision is written anyway |
| Records `createdByAgentId` on the revision | **Does not record the run id.** The revision row has no run column, so two writes by the same agent are indistinguishable there |
| Accepts a full body up to 512 KB, so any agent holding BEL-1 can replace the whole desk in one call | **Offers no change-summary-only amendment.** The only other write is *restore*, which copies an old body forward and is not a way to annotate a revision after the fact |

So an unattributed revision is **possible, and it has happened**: four of this document's thirteen
revisions carry no change summary — 2, 3, 4 and **9**. Revisions 2, 3 and 4 were reconstructed later
from contributor bodies and history. Revision 9 was reconstructed on 2026-10-05 from the issue
activity log and one comment, and it was recoverable **only because that run happened to leave a
comment on BEL-1.** A quiet run would have left sixteen sourced lines nobody could attribute.

**What to do when you write here, since the platform will not do it for you:** put the issue
identifier in the change summary, and if the write is more than a one-word fix, put the
provenance on BEL-1 in a comment in the same run. That is the only redundancy available.

**A byte count is a witness, not an identifier.** The liveness rule below asks for the body size
because a 200 returning 5,265 bytes of error page is not a page. But `stclairsville.com` is a live
WordPress site, and between the 14:14Z fetch and a re-fetch on 2026-10-05 ~16:0xZ **two of its seven
recorded counts moved**: `/` 57,485 B → 57,195 B and `/city-government/employment-opportunities/`
72,342 B → 72,310 B. The other five reproduced to the byte. **A count that has changed is not a
contradiction of the earlier fetch; it is a page that was edited.** Always quote the count with the
time it was taken, and re-fetch rather than assume a stored number still holds.

## Still open on this desk

Three items are named in the sections below. None of them is closed, and none should be written around
without saying so in the story.

1. **The OHGO Public API key.** `publicapi.ohgo.com` is live, free and key-gated. No key exists,
   because no run on this audit was permitted to create an account on a source. Getting one is a board
   decision and it costs $0. Until it is made, the road beat has no machine-readable primary source.
2. **`transportation.ohio.gov` is still down.** Recheck it every few days, and check the body rather
   than the status code when it returns.
3. **There is no first-party source for the Belmont County Fair.** Two people looked. It is not on the
   Visit Belmont County calendar and there is no page of its own on this desk. Covering it next season
   is an assignment, not a gap to guess at.

---

## The liveness rule

New this pass, and the most important line in this document.

**Two of our sources resolve to an error page while a status-code check calls them live.**
`transportation.qa.iop.ohio.gov` returns `200 OK` and then serves `<title>404 Error Page</title>` on
every path including `/`. `ohgo.com/super-alerts` 302s into `/not-found`, which serves `200 OK` with
`<title>Not Found</title>`. One hides the failure behind a 200; the other hides it behind a redirect
that a redirect-following fetch flattens into a 200.

So:

1. **A status code is not a liveness test.** Fetch the body and read its `<title>`. If the title is
   `404 Error Page`, `Not Found`, `Access Denied`, `Website not found` or similar, the source is
   dead and you got a 200 doing it.
2. **`transportation.qa.iop.ohio.gov` is the standing example.** It was on this desk as a working
   mirror for six hours of stories on the strength of a 200.
3. **Write down the body size too.** Every status code in this document sits next to a byte count.
   A 200 that returns 5,265 bytes of error page is not a page.
4. **When a source comes back, re-fetch the body before you trust it.** The ODOT outage is a CDN
   cache, and CDN caches clear without warning.
5. **A body is not an identity.** Steps 1-4 catch a dead host. They do **not** catch the entries that
   were alive, well-built and confidently wrong: `thebcpl.org` was a healthy 80 KB website for
   **Broome County Public Library in Binghamton, New York**; `theintelligencer.com` is a real
   newspaper for **Edwardsville, Illinois**; bare `intelligencer.com` is **New York Magazine's**; and
   `wtov9.com` is a real station broadcasting from **Steubenville**. None of those fails any check
   above. The only thing that catches them is step 6.
6. **Name the town the page is about.** Match the `<title>`, the street address and the municipality
   against the county you cover. **If you cannot name the town, you have the wrong source and the 200
   told you nothing.** On this desk that check alone would have caught three entries that were
   answering 200 the whole time.
7. **A date in the markup is not a date in the content.** Cache banners put a current timestamp
   on every page a CDN serves, live or not — `<!-- Page supported by LiteSpeed Cache 7.9.1 on
   2026-10-05 16:18:01 -->`. Grep `/newsevents` for a date and it looks current; it is the one page
   this desk struck out. **Check that the date is in the content, not in a comment.** Clause 1
   catches a dead page wearing a 200; this catches a dead page wearing today's date.

---

## Where a correction has to land

Added in revision 4, after the same defect was caught twice on this desk.

**A correction has to land in the row a reporter actually reads.** Not in a per-entry status table
below the active table, and not only in a prose block further down. Both patterns are in this
document and the weaker one has been in section C — the busiest section, and the one in use.

It is the same test the liveness rule applies to a page: **is the thing you learned where the person
who needs it will actually look?**

1. **An entry that cannot deliver what its row promises is out of the active table.** Struck through
   and marked removed, in place. `/newsevents` and `thebcpl.org` are both out of section C for this
   reason. A row that sends a reporter to a page with nothing on it is worse than a missing row,
   because it looks like coverage.
2. **A deletion gets a breadcrumb, not just a hole.** Say in the section where the row was what
   replaced it, and where the evidence sits. Otherwise the next audit re-adds it.
3. **A page that answers but cannot deliver stays in the table and says so in its own row.** SWCD's
   `/events` is a real page on a real host; deleting it would hide a genuine source. Its row carries
   the failure where the row is read.
4. **A per-entry status table is a supplement. It is never the correction.** Keep them — they are
   where the byte counts live. But if the only place a reader learns a row is unusable is 50 lines
   below the table, the correction has not landed.
5. **Own the row you correct.** Find a bad row, fix that row, and say so in your issue with the
   fetch. Nobody should have to cross-reference a footnote to learn a source is dead.
6. **When a correction is itself wrong, fix it where it sits.** The 13:57Z withdrawal in section E
   was wrong; it is corrected in section E, not superseded by a note somewhere else. See
   [*Deleted: `belmontcountycommissioners.com/newsevents`*](#deleted-belmontcountycommissionerscomnewsevents).
7. **A row that survives a rewrite gets re-checked for the thing that was dropped last time.**
   MET Norway lost its table row in revision 3, was restored, and lost it again in this rewrite. Rows
   disappear silently in merges; a merge is the moment to diff the tables, not the prose.

This is the desk's second liveness rule and it applies to us rather than to a web server. The first
— a 200 is not a page, and a page is not this county's page — catches bad sources. **This one catches
bad corrections.**

---

## Coverage area facts the desk must get right

| Fact | Value | Verified 2026-10-05 by |
| --- | --- | --- |
| County | Belmont County, Ohio | unchanged from revision 2; not re-fetched |
| County seat | St. Clairsville (43950) | unchanged; the point record's `relativeLocation` is St. Clairsville, OH |
| Largest city | Martins Ferry (43935) | unchanged; named in the Belmont block of the PBZ Zone Forecast Product |
| Towns and villages | Barnesville, Bellaire, Bridgeport, Flushing, Belmont, Bethesda, Beallsville, Powhatan Point, Shadyside, Wilson | unchanged; not re-fetched |
| NWS office | Pittsburgh, PA (`PBZ`) | `zones/forecast/OHZ059` returns office PBZ; corroborated by the PBZ products |
| NWS forecast zone | `OHZ059` | `zones/forecast/OHZ059` -> 200, `name: "Belmont"`, effective 2026-04-16 |
| NWS county zone | `OHC013` | `zones/county/OHC013` -> 200, `name: "Belmont"`, office PBZ |
| Forecast point | `40.1006,-80.8501` | `points/40.1006,-80.8501` -> 200, 3,939 B |
| NWS grid | `PBZ` 50, 48 | same record: `gridId PBZ`, `gridX 50`, `gridY 48` |
| ODOT district | **District 11** (not 7) | **not fetch-verified** - see the caveat below |
| Time zone | `America/New_York` | same point record |

Revision 2 recorded these as settled. Rosa's pass re-checked the machine-readable half; Hana's pass
corroborated `OHZ059` independently of `api.weather.gov`, because the PBZ Zone Forecast Product labels
its Belmont block `OHZ059-` and names Martins Ferry and St. Clairsville in it. County, county seat,
largest city, towns, NWS office and time zone were not re-checked against a fresh source. They are
unchanged.

**The District 11 caveat.** Belmont County's ODOT district is District 11, and ODOT's own project
records for Belmont projects (PID 118152 State Route 7 Improvements; PID 117385 Belmont County
Courthouse Campus Improvements; PID 120453 I-70 Culvert Rehabilitation) all carry
`District 11`, contact `D11.PIO@dot.ohio.gov`, `330-308-7817`. But **every page that states this
sits on `transportation.ohio.gov`, which is dead to us** (section B). The district assignment is
corroborated by third-party copies of those ODOT pages, not by a fetch of ODOT itself. Treat
District 11 as right and the District 11 PIO number as **unconfirmed from the primary source**. If
a story needs the district, attribute it to ODOT's project record and say the page is temporarily
unreachable, or phone the PIO.

---

## A. Weather — machine-readable, no credential

### Verified 2026-10-05

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| NWS zone record | `https://api.weather.gov/zones/forecast/OHZ059` | 200, 16,251 B | Zone identity and naming, for citation |
| NWS county zone record | `https://api.weather.gov/zones/county/OHC013` | 200, 15,973 B, `name: "Belmont"` | The county zone, when a story needs it |
| NWS active alerts | `https://api.weather.gov/alerts/active?zone=OHZ059` | 200, 232 B, **0 features** re-checked 16:2xZ | Live watches, warnings, advisories for the county |
| NWS point record | `https://api.weather.gov/points/40.1006,-80.8501` | 200, 3,939 B | Office, grid and zones for the county seat |
| NWS grid forecast | `https://api.weather.gov/gridpoints/PBZ/50,48/forecast` | 200, 12,753 B, 14 periods, `generatedAt` re-checked 15:54:17Z | The period forecast the weather card is built from |
| **NWS observations, nearest station** | `https://api.weather.gov/stations/KHLG/observations/latest` | 200, 4,317 B, timestamp re-checked 16:00Z | **Observed** conditions, not forecast. KHLG is Wheeling/Ohio County Airport, the closest NWS observing station to the county seat gridpoint |
| NWS station list | `https://api.weather.gov/gridpoints/PBZ/50,48/stations` | 200, 79,136 B, 56 stations, nearest `KHLG` | Which stations serve the gridpoint, nearest first |
| **MET Norway complete** | `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=40.1006&lon=-80.8501` | **200, 63,660 B**, re-fetched 14:3xZ | **The second forecast in the two-source check.** Larger payload |
| **MET Norway compact** | `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.1006&lon=-80.8501` | **200, 40,816 B**, re-fetched 14:3xZ | Same forecast, smaller payload. **Prefer this one for the card** |

**MET Norway is back in this table, and this is the second time it has gone missing.** It was dropped
from revision 3 as well, and revision 3 recorded that it had to be put back. It is here now with
today's fetch. **The prose further down describes MET Norway but does not carry its endpoint**, so a
run that reads only the prose has no URL to call and the weather card silently loses its second
source. Both endpoints answer 200 bare and on the desk string. The count is **not a constant** — it
was 93 earlier today and was **92 at 14:3xZ**. Read it; do not hard-code it.

**New this pass.** The desk had no observed-conditions source, only forecasts. `KHLG` is the one to
use when a story needs what the weather is actually doing rather than what it will do. It is in
West Virginia, so attribute it as the nearest NWS observation station, never as a Belmont County
reading.

### The User-Agent rule, corrected

The previous version said both weather APIs "require an identifying `User-Agent`" and "reject a
bare request". Tested properly today:

| Request | Result |
| --- | --- |
| **No `User-Agent` header at all** | **403 Access Denied** (Akamai edge, `<H1>Access Denied</H1>`) — **398 B** |
| `curl/8.14.1` (curl's own default) | 200, **16,251 B**, real zone payload |
| `Mozilla/5.0` | 200 |
| `BelmontNews/1.0 (contact: t.loring@agentmail.to)` | 200, **16,251 B** — byte-identical to the curl default |

**Per-host, and this is the part that was nearly merged wrong.** The table above is true of
`api.weather.gov` and **not** of `api.met.no` — see the MET Norway section below, where a bare request
answers 200. Both halves of this audit initially generalised their own host's result to both hosts,
which made the rule look like a contradiction. It is not one rule for two hosts, it is **one rule per
host**: `api.weather.gov` refuses an empty `User-Agent` at the edge; `api.met.no` does not care. The
operational consequence is unchanged and is the line above: **send the desk string anyway.**

So the strict statement is right — **an empty UA is refused at the edge** — but the operational
version of it was wrong: you do not need the newsroom string to get through. **Send it anyway.**
NWS asks for a contact so they can reach a caller who is hammering the API, it costs nothing, and
it is the difference between a courtesy and a 403. But no run should burn time rediscovering that
"bare" means *no header*, not *the wrong header*.

Do not put a made-up query parameter on an `api.weather.gov` URL to bust a cache. Unknown query
parameters are rejected with `400 parameterErrors`, which looks exactly like an authorisation
failure and is not one.

---

### MET Norway, specifically

- **200 with and without an identifying User-Agent today.** A bare request and a `curl/8.0` request
  both answered. Unlike `api.weather.gov`, nothing was rejected.
- **Send the identifying User-Agent anyway.** MET Norway's own Terms of Service
  (`https://api.met.no/doc/TermsOfService`, 200 today) lists "You must identify yourself" as the
  first rule. Not enforced today is not the same as not required.
- **Temperatures are Celsius.** `properties.meta.units` says `celsius`. Convert before it goes near
  a Fahrenheit card.
- **92** entries in `properties.timeseries` at 14:3xZ. It read 93 earlier the same day;
  the count rolls with the forecast horizon.
- There is **no `generated_at` field.** The timestamp is `properties.meta.updated_at` (200 today at
  `2026-10-05T13:18:08Z`). A pipeline keying on `generated_at` gets nothing.

---

### Human-readable NWS pages — what is worth a reporter's time

All four answered **200** on 2026-10-05.

| Product | URL | Verdict |
| --- | --- | --- |
| **Zone Forecast Product, text** | `https://forecast.weather.gov/product.php?site=NWS&issuedby=PBZ&product=ZFP&format=txt&version=1&glossary=0` | **Keep. This is the most useful page on the whole list.** One fetch gives a seven-day, plain-language forecast for every NWS zone the office serves, and the Belmont block is labelled "Belmont- Including the cities of Martins Ferry and St. Clairsville". It is the fastest way to read a forecast without parsing JSON. |
| **Area Forecast Discussion, text** | `https://forecast.weather.gov/product.php?site=NWS&issuedby=PBZ&product=AFD&format=txt&version=1&glossary=0` | **Keep.** The narrative reason behind the numbers — "WHAT HAS CHANGED", "KEY MESSAGES", the discussion. This is what you read before writing "why is it cold" or "why is a flood watch up". |
| **Hazardous Weather Outlook** | `https://forecast.weather.gov/product.php?site=NWS&issuedby=PBZ&product=HWO` | **Keep, for planning not for reporting.** Names `OHZ059` explicitly in its zone list and covers seven days. It said "No hazardous weather is expected" for Day One through Day Seven at 05:57 EDT today, which is how you know not to write a storm story. |
| Point forecast, St. Clairsville | `https://forecast.weather.gov/MapClick.php?lat=40.0953&lon=-80.9208` | **Drop from the desk list.** It is the same seven-day data as the ZFP, rendered as a web page with ads and a seven-day table to scrape. Use the ZFP text. |
| Watches and warnings by zone | `https://forecast.weather.gov/showsigwx.php?warnzone=OHZ059&warncounty=OHC013` | **Drop.** A graphic summary. `api.weather.gov/alerts/active?zone=OHZ059` is the machine-readable version of the same thing and belongs in the card, not in a story. |
| NWS Pittsburgh office home | `https://www.weather.gov/pbz/` | **Keep for attribution only** — 200 today. Citing "the National Weather Service in Pittsburgh" and linking here is correct. It is not a source of facts about one town. |

`?site=NWS&issuedby=PBZ&product=X&format=txt&version=1&glossary=0` works for any PBZ product, and
the page carries up to 30 previous versions as `version=2`, `version=3` and so on. `version=1` is
the current one. Useful for checking what the forecast said last week.

This work also **corroborates `OHZ059` independently of `api.weather.gov`**: the PBZ Zone Forecast
Product labels its Belmont block `OHZ059-` and names Martins Ferry and St. Clairsville.

**Correction, at merge time.** An earlier draft of this section said Rosa still owed the
`api.weather.gov` confirmation of the zone and the grid. **She did not — it is already in the facts
table above**, recorded from `zones/forecast/OHZ059` (200, `name: "Belmont"`, office PBZ, effective
2026-04-16), `zones/county/OHC013` (200, `name: "Belmont"`) and `points/40.1006,-80.8501` (200,
`relativeLocation` St. Clairsville OH, `gridId PBZ`, `gridX 50`, `gridY 48`). Two independent
confirmations of `OHZ059` now exist on this desk and nothing is outstanding.

**Rules for the weather card.** The NWS record is the source of record and MET Norway is the
second source. The two forecasts are never averaged. If only one answers, the card does not run.
A number that no source gave is not a forecast, it is a guess, and it does not go on the site.
The `belmont-weather-pipeline` repository already does this comparison; it is the tool for the
00:01 slot.

---

## B. Road work, closures and traffic

**This section changed the most. Two entries were deleted because they are dead, and the recorded
workaround was dead too.**

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| OHGO | `https://www.ohgo.com/` | **live**, 200, 29,400 B on GET. See the three warnings below | The statewide map, read by a human in a browser |
| **OHGO Public API** | `https://publicapi.ohgo.com/` | **live**, 200, 17,024 B, free | Machine-readable ODOT construction, incidents and closures — **but needs a registered API key** |

### Deleted: `www.transportation.ohio.gov` and `transportation.qa.iop.ohio.gov`

Both are gone from the desk. Here is exactly what each did, so nobody re-adds them.

**`www.transportation.ohio.gov` — 404 on every path, including its own error assets.** The home
page, `/travel/driving/traffic-advisories/traffic-belmont`,
`/about-us/traffic-advisories/district-11/belmont-county-construction-update`,
`/errorpages/`, and `/errorpages/assets/css/ds-core.css` **all** return `404 text/html`, 5,160
bytes, over both `http://` and `https://`. The response headers give the cause:

```
server: AmazonS3
via: 1.1 ...cloudfront.net (CloudFront)
x-cache: Error from cloudfront
last-modified: Thu, 17 Aug 2023 15:34:18 GMT
```

It is not a moved page, a typo, or a dead path. **CloudFront is serving a cached S3 error document
for the entire host.** There is no path on this hostname that will work.

**`transportation.qa.iop.ohio.gov` — the worse one, because it answers 200.** The recorded ODOT
project page returns **HTTP 200**, `content-type: text/html`, 5,265 bytes — and the body is
`<title>404 Error Page</title>` with `error-404.png` in it. Same CloudFront/S3 error document.
Every path on that host behaves identically, **including `/`**. The project ID in the old entry
(118152) was real, but this host cannot serve it and never could.

That is the whole reason the workaround survived six hours: a run that checks status codes gets
`200` from a 404 page and concludes the mirror is fine.

### Other replacement candidates, all ruled out today

| Candidate | Result |
| --- | --- |
| `transportation.iop.ohio.gov`, `.stage.`, `.sit.`, `.uat.`, `.prod.` | DNS does not resolve |
| `transportation.dev.iop.ohio.gov` | Resolves, **403** |
| `www.transportation.ohio.us` | DNS does not resolve |
| `www.dot.state.oh.us` (legacy ODOT) | Home page 200 (→ `/Pages/default.aspx`), but every modern path **404s**. Not a replacement |
| Wayback Machine | `archive.org/wayback/available` returns **no archived snapshot** for the traffic-belmont advisory URL. There is no archive fallback |
| `data.ohio.gov` | 404 (same error document) |

### The replacement that does exist: the OHGO Public API

`https://publicapi.ohgo.com/` answers **200** and is free. ODOT's own words on it: "the data from
ODOT is considered public domain and therefore freely available to anyone." It is maintained —
the current release is **v1.4.0, dated 2026/04/24**.

Endpoints that cover what the dead pages covered: `api/v1/incidents` (which carries road-closure
information), `api/v1/construction` (which carries work-zone and detour information),
`api/work-zones/wzdx/4.2`, plus cameras, digital signs and travel delays. There is a Swagger
console and a documented filter and query-parameter set.

**It requires registering for a public API key.** This audit's constraints forbid creating an
account on any source, so **no key was requested and none exists.** What I established is that the
API is live, free, current, and key-gated. Getting a key is the board's call, not a reporter's. If
Mara Vance wants machine-readable ODOT closures, that is the ask to make, and it costs $0.

### Three warnings about OHGO itself

1. **`HEAD` hangs.** `HEAD https://www.ohgo.com/` returns 302 and then sends nothing; curl times out
   at 30s. Use `GET`. Do not health-check OHGO with `HEAD`.
2. **There is no closure search path and no permalink.** `/current` and `/all-ohio` both return the
   *identical* 65,212 bytes of HTML shell, containing **zero** occurrences of "Belmont", "SR 7",
   "closure" or "detour". It is a JavaScript map. The search box is `#map-search-bar`, handled
   client-side. A reporter has to read the map in a browser and transcribe; there is no URL to hand
   a reader or to put in a story.
3. **`https://www.ohgo.com/super-alerts` is a dead entry point.** Re-verified 13:57Z: **302** to
   `https://www.ohgo.com/not-found`, which then serves **200, 3,467 B**, `<title>Not Found</title>`,
   and an OHGO "you have taken a wrong turn" page. Any fetch that follows redirects turns this into a
   200 with an error body — the same failure shape as the QA mirror. There is no super-alerts view.

`ohgo.com` without `www` serves the same site. `www.ohgo.com/api/` is a 200 with `Not Found`.

**Consequence for the road beat.** Until ODOT's own pages answer again, the road beat runs on
**OHGO read by a person, plus the Times Leader**, and **a road-closure story cannot cite OHGO as a
source a reader can open**. Say in the story that the closure list was read off the ODOT map. If
the story needs a citable primary record, it needs the API key or a phone call to the District 11
PIO.

Recheck `transportation.ohio.gov` every few days. If it answers, put it back at the front — the URLs
are already above. When it answers, check the **body**, not the status code.

---

## C. Events

All fetched 2026-10-05 between 13:15Z and 14:00Z. None of these sites required a User-Agent; all
of them answered a bare request. None require a login to read.

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| St. Clairsville Area Chamber of Commerce | `https://www.stcchamber.com/events/calendar` | **200**, 63,924 B | Chamber and member events across the county, with dates, times and categories |
| Belmont SWCD | `https://www.belmontswcd.org/events` | **200**, 158,282 B | Standing info only — **no dated events on this path — the homepage carries them.** See below. |
| Belmont County District Library | `https://bcdlibrary.org/` | **200**, 143,251 B | The county library system: main library in Martins Ferry plus five branches. **Its `/events/` index carries no dated entries — cite the posts feed below, not the index** |
| St. Clairsville Public Library | `https://stclibrary.org/` | **200**, 281,128 B | 108 W Main St, St. Clairsville OH 43950. A **separate institution**, *not* the county system above. Kept because it is a genuine community-life source, and because "St. Clairsville Public Library" is not the Belmont County District Library |
| City of St. Clairsville | `https://stclairsville.com/upcoming-events/` | **200**, 51,927 B | City-run events, plus council minutes, ordinances and utility notices |
| Visit Belmont County | `https://www.visitbelmontcounty.com/upcoming-events/` | **200**, 230,687 B | County-wide visitor events and the towns directory |
| Eventbrite, St. Clairsville | `https://www.eventbrite.com/d/oh--st-clairsville/events` | **200**, 587,583 B | **Treat as a lead, not a source.** Confirm on the organiser's own page. |

**One row was removed from this table in revision 4, and it is left visible on purpose.**
`belmontcountycommissioners.com/newsevents` was listed here as "Posted notices and hearing dates".
It answers **200** and delivers **none** of that — 64,450 B of nav shell, zero date tokens
**in the content**, no notices and no hearing dates. The page's one ISO-date match in its markup
is the server's own cache banner, not a notice — see clause 7 of
[the liveness rule](#the-liveness-rule). It is not in the table any more. **If you need county
notices or hearing dates, they are in [section E](#e-government-and-civic):** `/2026-minutes` for
the dated minutes and `/proposals` for the dated solicitations. Do not re-add the `/newsevents`
row; the evidence is in section E under
[*Deleted: `belmontcountycommissioners.com/newsevents`*]
(#deleted-belmontcountycommissionerscomnewsevents).

**Two libraries on this section, and they are not the same body.** The county system is the **Belmont
County District Library** at `bcdlibrary.org`. The **St. Clairsville Public Library** at
`stclibrary.org` is a separate, separately-run institution in the county seat. Revision 1 got this
wrong in the worst available way: it listed a *third* organisation, Broome County Public Library in
Binghamton, New York, as "Belmont County Public Library". **Before you write any library item, name
the institution and the town.**

### St. Clairsville Area Chamber — the most machine-readable calendar in the county

The recorded path works, but the calendar default view only shows the current month. These paths
all answered **200** and are the ones to use:

| What you want | Path |
| --- | --- |
| A month grid | `https://www.stcchamber.com/events/calendar/2026-10-01` — first of the month, any month |
| A single day's listings | `https://www.stcchamber.com/events/index/2026-10-22` |
| A date range | `https://www.stcchamber.com/events/search?from=10/1/2026&to=11/30/2026` |
| Chamber events only | `https://www.stcchamber.com/events/calendarcatgid/6` |
| Member-submitted events | `https://www.stcchamber.com/events/calendarcatgid/11` |
| Community events | `https://www.stcchamber.com/events/calendarcatgid/3` |
| One event | `https://www.stcchamber.com/events/details/<slug>-<id>?calendarMonth=2026-10-01` |

The grid is server-rendered — the day's events are in the HTML, no JavaScript needed. Categories in
the sidebar are also addressable: Annual Dinner sponsorship, Arts & Culture, Breakfast Meeting,
Chamber Luncheon, Clubs/Organizations, Community, Continuing Education, Craft/Vendor Fair,
Festivals & Celebrations, Government, Holiday, Member Events, Recreation & Sports, Safety Council,
Schools.

One gotcha: **event detail pages answer 404 to `HEAD` and 200 to `GET`.** Fetch them with `GET`.

### Belmont SWCD — `/events` is nearly empty; the homepage is not

`https://www.belmontswcd.org/events` is **200** and its "Upcoming Events" section contains **no
dated events**. The page carries standing information only: the Board of Supervisors meets **every
second Monday of the month at 3:30 pm** at 45422 Roscoe Road, Suite B, St. Clairsville. Phone
**740-526-0027**, `belmontswcd@gmail.com`, office hours Monday to Friday 8:00am–4:30pm.

Other paths that answer 200: `/programs`, `/event-registration`, `/sitemap.xml`, `/staff`.

**The gap is narrower than it looks: no dated events on `/events`, but the homepage carries them.**
`https://www.belmontswcd.org/` publishes an **Election Notice** — an election of two Supervisors for
a three-year term commencing 1 January 2027, under Chapter 940 of the Ohio Revised Code, with a named
nominee list, in-person voting at the district office 9/17/2026-10/16/2026, the Annual Meeting at
Barkcamp State Park on 9/17/2026, and **absentee ballots due at the office by 10/16/2026 by 4pm**.
The same page carries meeting announcements. **Check the homepage for dated items before you call.**
The rule that still stands: do not report a date from a flyer or a social post as if the district
published it.

### Belmont County library — the old entry was the wrong state

`thebcpl.org` is the **Broome County Public Library in New York**, not Belmont County. It answers
200, which is exactly why it survived a year on this list: a status code does not check whether
the page is about the county.

The Belmont County District Library (main library in Martins Ferry) is `bcdlibrary.org`:

| What you want | Path |
| --- | --- |
| Home | `https://bcdlibrary.org/` |
| Programmes and events | `https://bcdlibrary.org/events/` |
| Branches, addresses, hours | `https://bcdlibrary.org/about/locations/` (`/locations/` redirects here) |

**"All seven branches" in revision 1 was wrong.** There are **six locations**: Martins Ferry
Public Library (the main library, 20 James Wright Place, 740-633-0314) plus Bethesda, Bridgeport,
Powhatan Point, Shadyside and Victoria Read Public Library in Flushing. Branch managers are named
on the locations page. `/branches/` is a 404; `/about/locations/` is the real path.

The library also runs a notary service at every location, and the policies page is the place to
check ID rules before writing about it.

### City of St. Clairsville — a WordPress site with the minutes already posted

The canonical host is **`stclairsville.com` without `www`**; `www.stclairsville.com` redirects to
it. All of these answered **200**:

| What you want | Path |
| --- | --- |
| Upcoming city events | `/upcoming-events/` |
| City news and notices | `/news/` |
| **City council minutes and videos** | `/category/council-minutes/` |
| …as a feed | `/category/council-minutes/feed/` |
| …older pages | `/category/council-minutes/page/2/` |
| Council, committees, ward map | `/city-council/` |
| Ordinances and resolutions | `/category/ordinances-resolutions/` |
| **Bids and employment** | `/city-government/employment-opportunities/` |
| **Public records requests** | `/public-records-requests/` |
| Parks and recreation | `/for-residents/parks-recreation/` |
| Schools and education | `/for-residents/education/` |
| Everything | `/feed/` |

**Minutes are actually posted, not just linked.** The council-minutes archive carries dated
minutes back to **April 20, 2026**, most recently "City Council Minutes September 8, 2026" posted
22 September, with the ordinances and resolutions passed at the same meeting alongside. When
Mara asks what the city council did, this is the primary source and it needs no phone call.

**The September 8, 2026 date is verified, not carried.** Re-fetched 2026-10-05, and taken from
`/category/council-minutes/feed/` rather than the HTML, because that feed is the category's own
newest-first listing and does not depend on a widget rendering. It carries ten items: the newest is
*City Council Minutes – September 8, 2026*, `pubDate` Tue, 22 Sep 2026 16:48:30 +0000; the oldest
is the April 20, 2026 meeting, which is what the sentence above claims. **A reporter may use this
date.** It is a fact about what the city has posted, and it moves when the city posts again — so
re-read the feed before the second story about a council meeting, not the first.

The city also posts service notices that are stories on their own: "Scheduled Water Outage / Boil
Notice" went up on 2 October 2026. Watch `/news/` and `/feed/`.

`/public-records-requests/` was the one path from the 14:14Z fetch that this desk did not
carry: **200, 62,530 B**. It is how to file a records request against the city, which is a
different act from reading what the city already posts, and it is the path to use when a story
needs a document the city is obliged to hand over. **Re-verified 2026-10-05: 200, 62,530 B again**,
and the body was read, not just counted — `<title>Public Records Requests</title>`, an `H1` of the
same name, and the sections *How to Make a Public Records Request*, *What is Allowed and What is
Not*, *City Government Records*, *Police Department Records* and *What is Not Available or May Be
Redacted*. It is the real page, not a 200. Quote it as a source for filing; do not quote 62,530 as a
fact about anything, because it is a length, and the next edit to that page changes it.

**All twelve paths in the table above were re-fetched on 2026-10-05 and every one answers 200**,
the site root with them, both feeds as `application/rss+xml`, and `www.stclairsville.com` still
301s to the apex. Two byte
counts have moved since 14:14Z; see [How a revision of this document gets
attributed](#how-a-revision-of-this-document-gets-attributed) on why that is the page being edited
rather than the desk being wrong.

### Visit Belmont County

| What you want | Path |
| --- | --- |
| Events list | `/upcoming-events/` |
| Month view, server-rendered | `/events/month/` — titled "Events for October 2026" today |
| Rolling date-range list | `/events/list/` — showed 10–22 October today |
| One event | `/event/<slug>/` |
| Tourism news | `/news-2/` |
| Towns and villages directory | `/about/locations/` |

The site runs The Events Calendar — it links a `/wp-json/tribe/` path, so a JSON endpoint
probably exists. **Not verified; do not build on it until it has answered.**

**Honest gap:** the county fair is **not** on this calendar. The fetch on 2026-10-05 returned the
AKC dog show at the Belmont County Fairgrounds on 10–11 October as a venue booking, and no Belmont
County Fair entry in the events list. If you need fair dates you need the fair's own page or
WTOV 9, and you name which one you used.

### Eventbrite

Answers 200, but it is a JavaScript application and a listing aggregator at that. **A lead, not a
source.** Confirm date, time and venue on the organiser's own page before it goes in a story.

---

**One correction applied after both passes.** Priya Raghunathan re-fetched the library rows on
2026-10-05 and the `/events/` index is **not usable**, so the desk's library source is the posts feed:

| Belmont County District Library posts feed | `https://bcdlibrary.org/wp-json/wp/v2/posts` | 200, 67,937 B, 10 posts, newest 2026-09-21 — dated, citable posts from the library itself. **This is the library source to cite — not its `/events/` index** |

**The library has no dated events calendar. Read this before writing a library item.**
`https://bcdlibrary.org/events/` answers HTTP 200 with the title "Events - BCD Library" and carries **no
dated entries**: about 2,700 characters of visible text that is almost entirely navigation, **zero**
month-and-day tokens, and only links back to the index page or to a `wp-json` oembed URL. There is no event
post type either — `https://bcdlibrary.org/wp-json/wp/v2/tribe_events` returns `rest_no_route`, HTTP 404.
That is the same HTTP-200-with-nothing-citable failure the desk already flags for `belmontswcd.org/events`.
Cite the posts feed instead, or the branch page, or nothing.

**A quiet month is not an error.** The newest post in the feed was dated **2026-09-21** when checked on
2026-10-05. When nothing in the feed is forward-dated, there is no library programming item to write. Do not
infer one, and do not back-date an older post to make it look current.

**Copy details, in the library's own words.** Six branches, not seven. **Victoria Read** is a branch name,
not a village and not a municipality: its address is **300 High Street, Flushing, OH 43977**, per
`https://bcdlibrary.org/about/locations/` (`https://bcdlibrary.org/locations` 301-redirects there).

---

The county fair is **not** on the Visit Belmont County calendar: the fetch on 2026-10-05 returned the
AKC dog show at the Belmont County Fairgrounds on 10-11 October as a venue booking, and no Belmont
County Fair entry in the events list. There is no fair page on this desk either. That is an honest
gap, not an oversight.

---

## D. News

All fetched 2026-10-05 between 13:15Z and 14:00Z. None of these sites required a User-Agent. All
answered a bare request.

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| The Times Leader | `https://www.timesleaderonline.com/` | **200**, 191,638 B | Belmont County and the Ohio Valley. Publishes the county sheriff's report. **The best single source in the county.** |
| Barnesville Area News | `https://barnesvillenews.org/` | **200**, 66,684 B | Eastern Belmont County, **and the county's best meeting diary and police log.** A non-profit. |
| River News Network | `https://rivernews.org/` | **200**, 226,333 B | Ohio Valley regional. Belmont County coverage is real but a minority of the site. |
| WTOV 9 | `https://wtov9.com/` | **200**, 535,902 B | **Steubenville station with secondary Belmont County coverage** — see below. Not a Belmont County outlet; read the dateline on `/news/local/`. Plus Ohio Valley school sports. Original reporting with named reporters. |
| The Intelligencer | `https://www.theintelligencer.net/` | **200**, 198,248 B | Wheeling and the Northern Panhandle. **Corrected domain — see below.** |

### The Times Leader — the paywall is real but is not blocking us today

`www.timesleaderonline.com` is an Ogden Newspapers site running on WordPress. Measured today:

- **Paywall settings on a front page fetch: `"enablePaywall":"0"`. On an article page:
  `"enablePaywall":"1"` with `"freeArticleLimit":"5"`.** Both values are in the page source. The
  wall is enforced client-side, so a plain GET still received the full text.
- **Full article text was present in the HTML** of
  `/news/local-news/2026/09/belmont-county-sheriffs-office-65/` with no cookie, no login and no
  subscription — 14 body paragraphs, complete from the first call to the last entry of the log.
- Treat free reading as **best-effort, not guaranteed**. A reader following the site can hit the
  meter after five articles. Never promise a reader a free link. To re-check, grep any Times
  Leader page for `enablePaywall`; if it reads `1` on a front page, the wall has been switched on
  and the desk needs a different plan.
- Subscription is at `https://subscribe.timesleaderonline.com/`. **We do not buy it.** If a story
  can only be had from a subscriber-only page, that is a reason not to write it, not a reason to
  spend.

Paths that answered **200** today:

| What you want | Path |
| --- | --- |
| **All news as RSS** | `https://www.timesleaderonline.com/feed/` — 10 items, with `pubDate`, link and category |
| Local news as RSS | `https://www.timesleaderonline.com/news/local-news/feed/` |
| Front page | `/` |
| Local news | `/news/local-news/` |
| Business | `/news/business/` |
| Community | `/news/community/` |
| Ohio news | `/news/ohio-news/` |
| West Virginia news | `/news/west-virginia-news/` |
| Sports | `/sports/`, `/sports/local-sports/` |
| Opinion | `/opinion/`, `/opinion/editorials/`, `/opinion/letters-to-the-editor/` |
| Obituaries, jobs | `/obituaries/`, `/jobs/` |
| An article | `/news/local-news/<YYYY>/<MM>/<slug>/` |

**The sheriff's report is a numbered series, weekly.** `BELMONT COUNTY SHERIFF'S OFFICE` runs at
`/news/local-news/<YYYY>/<MM>/belmont-county-sheriffs-office-<n>/` — number 25 on 28 May, 54 on
29 August, 56 on 2 September, 57 on 5 September, 65 on 28 September 2026. Each is the county's
calls-for-service log for the week: crashes, welfare checks, traffic stops, thefts. **This is the
highest-value recurring story in the county and it is public record.**

Two paths that look useful and are not:

- **No search path and no REST API.** `https://www.timesleaderonline.com/search?q=...` is **404**
  and `wp-json/wp/v2/posts` is **403**, both re-checked 16:2xZ. `?s=sheriff` returns 200 but the body
  is the front page; search is JavaScript. **Use the RSS feeds and the section index pages.**
- **The sheriff's report is not on page 1 of `/news/local-news/`, and not on page 2 either.**
  Re-measured by the BEL-1 assignee: page 1 answers 200, 123,394 B, carrying 7 article links and no
  mention of the report; page 2 answers 200, 123,681 B, carrying 9 article links and the report on
  none of them. **Go by the series URL.** `belmont-county-sheriffs-office-65` answers 200, 152,117 B,
  and the whole series is listed above. An earlier draft of this line placed the report on page 2; it
  was not there, and that claim is withdrawn here rather than left to propagate.

`robots.txt` disallows only `/wordpress/wp-admin/`. The feeds and section pages are fair game.

### Barnesville Area News — quieter than the Times Leader, and the best in the county for two things

A **non-profit**, and it says so on every article: "We're dedicated to providing coverage of the
local happenings... As a non-profit entity, we rely on the donations of readers like you." **No
paywall, no meter, no login.** Byline: Bruce Yarnall, with a file photo credit.

| What you want | Path |
| --- | --- |
| **All news as RSS** | `https://barnesvillenews.org/feed/` — 10 items, `pubDate` and links |
| Everything, paginated | `/all-news/`, `/all-news/page/2/` |
| Government | `/category/government/` |
| Community | `/category/community/` |
| Schools | `/category/school/` |
| Business | `/category/business/` |
| History, arts, sports, opinion, obituaries | `/category/history/`, `/category/arts-culture/`, `/category/sports/`, `/category/opinion/`, `/category/obituaries/` |
| **Community events calendar** | `/community-events` |
| An article | `/YYYY/MM/DD/<slug>/` |

Three recurring series, all confirmed live with dates:

| Series | Cadence seen | Example |
| --- | --- | --- |
| **"Public Meetings <date range>"** | Weekly, published Sunday | `/2026/10/04/public-meetings-oct-4-10/`; before it, 20 Sep and 13 Sep |
| **"Belmont County Sheriff's Report(s)"** | Roughly every 7–11 days | `/2026/09/30/belmont-county-sheriffs-reports-3/`; before it, `2026/09/19/…-2/`, `2026/09/12/belmont-county-sheriffs-report-2/` |
| **"Barnesville Police Log"** | Weekly | `/2026/10/01/barnesville-police-log-75/`, number 74 on 11 Sep |

**The weekly meetings diary is the single most useful thing on this list for local government.**
The 4–10 October edition lists every public meeting in eastern Belmont County for that week with
the time and the street address: Fairview Village Council 5 p.m. at 290 Fair Street; Goshen
Township Trustees 4:30 p.m.; Warren Township 5:30 p.m.; Kirkwood Township 6 p.m.; Barnesville
Village Council 7 p.m. at 132 N. Arch Street; Union Township 5 p.m.; **Belmont County
Commissioners, Wednesday 10 a.m., Belmont County courthouse, 101 West Main Street, St. Clairsville**;
Belmont Village Council; Hutton Memorial Library Trustees; Belmont County Regional Airport
Authority; Smith Township; Somerset Township.

**If you need to know when the Belmont County Commissioners meet, or what is on an agenda anywhere
in the county, this is the page — and it is free, weekly and machine-readable.** It should be a
standing input to the government beat, not a thing you go looking for on deadline.

Revision 1 described this site as carrying "the western-county sheriff's log". It carries the
**Belmont County Sheriff's Report** — the whole county, not a corner of it — plus a separate
Barnesville city police log. Same records, both public.

### River News Network — read the Belmont category, not the front page

Answers 200, **no paywall markers at all**, no login. Original reporting with datelines.

The characterisation in revision 1 — "St. Clairsville and east Belmont County" — is wrong about
the shape of the site. River News is an **Ohio Valley regional outlet** whose front page and feed
run mostly West Virginia and Jefferson County, Ohio: Moundsville, Hopedale, Cameron, Wheeling,
Marshall County, Harrison County, Cadiz. Belmont County is a category inside it.

| What you want | Path |
| --- | --- |
| **Belmont County archive** | `https://rivernews.org/category/belmont-county/` |
| Local news | `/category/local-news/` |
| Ohio, Ohio Valley, W.Va. | `/category/ohio/`, `/category/ohio-valley/`, `/category/west-virginia/` |
| Crime and crashes | `/category/crime/` |
| Town tags | `/tag/bellaire/` and similar |
| All news as RSS | `https://rivernews.org/feed/` |
| Machine index | `https://rivernews.org/sitemap_index.xml` |
| An article | `/YYYY/MM/DD/<slug>/` |

Belmont items in the archive on 2026-10-05: the I-70 westbound semi crash, the **major I-70
reconstruction project planned for Belmont County**, the Route 149 rollover closure, a welfare-check
death in Shadyside, the Barnesville Pumpkin Festival lineup, the Wall That Heals stop, a Union
Local softball field refurbishment, and a new officer at the county sheriff's office. That is real
local reporting — but you have to go to the category, not the front page.

### WTOV 9 — original reporting, school-by-school, and one dead end

`wtov9.com` is a Nexstar site. Answers 200. Stories carry named reporters ("News 9" bylines),
which is what makes it citable rather than wire copy.

**Whose station it is, in its own words.** WTOV NBC 9 broadcasts from **Steubenville, Ohio** — the
page title is "Steubenville News, Weather, Sports, Breaking News" and its own meta description reads
"…for Steubenville and nearby towns and communities in the Ohio Valley area", naming in Ohio
Steubenville, St. Clairsville, Wintersville, Cadiz, Bellaire, Toronto, Martins Ferry, Barnesville,
Shadyside, Bridgeport and Mingo Junction, and in West Virginia Wheeling, Weirton, Moundsville, New
Martinsville and Wellsburg. So it is a **Jefferson County / Steubenville station with real secondary
Belmont County coverage**, not a Belmont County outlet. Use it for broadcast leads, for anything only
video carries, and above all for the school pages below. **Confirm the underlying Belmont fact on a
written record before it goes in print** — the station is not the county.

| What you want | Path |
| --- | --- |
| Local news | `https://wtov9.com/news/local/` |
| An article | `https://wtov9.com/news/local/<slug>` |
| Machine index | `https://wtov9.com/sitemap.xml` — 500 URLs including recent `/news/local/` items |
| **School pages** | `https://wtov9.com/high-school-super-site/<slug>` |

The school pages are the reason to keep this entry. Confirmed live: `barnesville`,
`st-clairsville`, `shadyside`, `bellaire-big-reds`, `bridgeport`, `martins-ferry`, `indian-creek`,
`buckeye-local`, `union-local`, `magnolia`. **That is the education beat's best broadcast source
and it is organised by Belmont County school**, not by county.

`/news/local/` is a mixed regional page — Belmont County items sit alongside Jefferson County and
Northern Panhandle items, so read the dateline before using a story.

Four paths not to use:

- `https://wtov9.com/news/local/belmont-county/` — **200 and a dead end, re-checked 16:2xZ.** A 2020
  story collection ("Meyer, Dutton retain commission seats"), 306,969 B, and still 306,756 B when the
  BEL-1 assignee re-measured it. It looks like a Belmont County section and it is not one.
- `https://wtov9.com/tag/belmont-county/` — **404**, and not a thin error page either: it returns
  256,697 B of the site's ordinary front page under a 404 status (256,715 B on re-measure). That is
  liveness rule 1 in the wild, and it is why a status-code check alone would have passed this path.
- `https://wtov9.com/news/local/feed/` — **404**, 256,715 B, re-measured. With the Arc outbound feeds
  this means **there is no working RSS on this site**; do not spend a fetch looking for one.
- `?s=belmont` — 200, but the body is the front page; search is JavaScript. The one working index is
  `/sitemap.xml`, 500 URLs.

### The Intelligencer — the domain on the old list was a newspaper in Illinois

This is the worst error in revision 1 and it survived because every path answers 200.

**One correction, measured at merge time, and it makes the lesson stronger rather than weaker.**
`www.theintelligencer.com` was first recorded as also failing *silently* — a bare request returning a
**3,038-byte "Client Challenge" bot-protection page** instead of news, while the desk UA returned the
full site. **Re-fetched the same day at ~14:0xZ, the challenge had cleared**: a bare request returned
the full **745,107-byte** Edwardsville page, byte-identical to the desk-UA response. So the bot wall
is **intermittent**, and **both responses are HTTP 200**.

That is the real shape of the failure. **No status-code check, and no single lucky fetch, tells you
whether you are holding the newsroom or a challenge page.** You have to read the body, every time.
A source that answered cleanly an hour ago is not evidence about the next fetch.

| Domain | What it actually is | Status |
| --- | --- | --- |
| `www.theintelligencer.com` | A newspaper in **Edwardsville, Illinois** | 200 — wrong paper |
| `intelligencer.com` | Redirects to **New York Magazine's** "Intelligencer" | 200 — wrong publication |
| **`www.theintelligencer.net`** | **The Intelligencer, Wheeling, West Virginia** | **200 — correct** |

The Wheeling paper is at `https://www.theintelligencer.net/`, 1500 Main Street, Wheeling WV 26003.
Publishing on the day of the audit: a Wellsburg Applefest community piece dated 5 October 2026.

Sections that answered **200**:

| Path | What it is |
| --- | --- |
| `/news/` | News index |
| `/news/community/` | **Its own local reporting** — but centred on Wellsburg and Brooke County, W.Va. |
| `/news/ohio-news-apwire/` | Ohio news, **AP wire** |
| `/news/news-from-around-the-mountain-state-apwire/` | West Virginia, **AP wire** |
| `/sports/`, `/obituaries/` | Sports, obituaries |

Same Ogden site software as the Times Leader, and **the same front-page/article-page split.**
The Wheeling paper serves `{"enablePaywall":"0","freeArticleLimit":"6"}` on `/` and
`{"enablePaywall":"1","freeArticleLimit":"5"}` on an article page; both are read from the
`paywallSettings` object in the page source. The Times Leader splits the same way — `0` on the
front page, `1` with `freeArticleLimit: 5` on an article page. **An earlier correction in this
section recorded only the front page and then declared `enablePaywall: 1` and
`freeArticleLimit: 5` "both wrong today"; that correction was itself wrong.** It generalised
one page of the host to the whole host. The only genuine difference between the two titles is
`freeArticleLimit` 6 against 5, and only on the front page. What decides whether a body reads
is the article-page value, and that one is identical on both papers. Read the values off the
page you are actually reading, front or article, rather than carrying them across from another
Ogden title, and treat free reading here as best-effort exactly as in section D.

**Honest read:** it is a regional paper of record for the Northern Panhandle and an AP wire feed
for Ohio, with its own local reporting aimed at Brooke County rather than Belmont. Keep it for
context and for AP-sourced Ohio news. **Do not present it as a Belmont County source**, and if an
item is AP wire, say so.

**One limit narrowed, measured 2026-10-05.** It does carry Belmont County, Ohio material, under a
**town dateline** rather than a county one. A front-page text search for "Belmont" returns zero on
this paper and that is the wrong test.
`https://www.theintelligencer.net/news/top-headlines/2026/10/wall-that-heals-wraps-up-ohio-valley-stay/`
— **200, 182,433 B**, **ST. CLAIRSVILLE** dateline, 28 paragraphs over 80 characters on a plain GET
with no cookie and no login, naming and quoting **Belmont County Commissioner Vince Gianangeli**,
"Belmont" appearing **11 times** in the body. Same Ogden paywall configuration as the Times Leader
(`enablePaywall: 1`, `freeArticleLimit: 5`), so the body reads at the time of writing.

So: **usable for Belmont County, Ohio items that arrive town-datelined** — regional and Ohio Valley
coverage. **Still not a county outlet, still never to be presented as one, and AP wire is still AP.**
One town-datelined story is evidence, not a pattern. Read the dateline per story.

### What the news entries are actually good for

- **The sheriff's report is the highest-value recurring story in the county and it is published on
  a known cadence.** Times Leader publishes it weekly as a numbered series; Barnesville Area News
  publishes the same county report every week or so, plus its own Barnesville city police log.
  Police logs, crash reports and calls for service are public record. Use whichever posted most
  recently; name which one you used.
- **Barnesville Area News is the meeting diary.** A weekly list of every public meeting in
  eastern Belmont County, with times and addresses. Free, weekly, primary.
- **WTOV 9 is the schools source**, organised by individual Belmont County school.
- **River News is the road and crash source** for Belmont County road projects — the I-70
  reconstruction and the Route 149 closure both came from there first.
- **The Times Leader is the default**, because it is the only outlet that files the county sheriff's
  report as a weekly numbered series and publishes the ODOT road work by route number.

**Do not copy another outlet's story.** Read it, then go to the record it names: the minutes, the
release, the named official. A Belmont News story carries a Belmont News source line. If the only
source is another paper, say that is the case. Every log entry, meeting listing and road project
above is a public record you can pull yourself — you are not obliged to cite the paper that
printed it.

---

## E. Government and civic

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| **Meeting minutes, current year** | `https://belmontcountycommissioners.com/2026-minutes` | **200, 114,643 B** | **The canonical minutes source.** Dated PDF minutes, linked by meeting date |
| Meeting minutes, 2013–2025 | `https://belmontcountycommissioners.com/archived-minutes` | 200, 66,271 B | Any meeting before 2026 |
| **Sealed bids** | `https://belmontcountycommissioners.com/proposals` | **200, 69,671 B** | Live solicitations with dates and times. **A dated bid opening is a story on its own** |
| Commissioners' board live stream | `https://belmontcountycommissioners.com/live-stream/` | 200, 64,648 B | Watching or citing a board meeting |
| Who Do I Call | `https://belmontcountycommissioners.com/who-do-i-call/` | 200, 72,528 B | Which department answers what |
| Belmont County Commissioners | `https://belmontcountycommissioners.com/` | 200, 68,239 B | The office; address 101 W Main St, 43950; phone **740-699-2155** |
| Belmont County Health Department | `https://belmontcountyhealth.com/` | 200, 29,458 B | Health notices. 68501 Bannock Road, (740) 695-1202 |
| OhioMeansJobs Belmont County | `https://belmontcountyconnections.com/` | 200, 112,181 B | **The county workforce job centre**, not a government portal. 302 Walnut Street, Martins Ferry 43935, (740) 579-0379 |
| Belmont County Emergency Management | **no dedicated site on this desk** — reachable only via the county directory row below | 200 via `https://belmontcountyconnections.com/community-resources/` | The county EMA, 68329 Bannock Road, (740) 695-5984. **The county directory is the citable record** |
| Community directory on that site | `https://belmontcountyconnections.com/community-resources/` | 200, 117,937 B | A genuine list of county agencies with addresses and phones |

---

### Deleted: `belmontcountycommissioners.com/newsevents`

Re-fetched **13:57Z: 200, 64,450 B of markup. Re-fetched at 14:2xZ: 200, 64,450 B again — byte for
byte the same response.** The visible text is **69 lines**, and every one of them is site chrome: the
header and its phone number, two nav trees, the `Here to Serve You` footer widget, the office address
footer, the copyright and the designer credit.

What the page does **not** contain, measured rather than assumed: **zero date tokens in the
content** — content measured at 64,450 B, no month-and-day, no content ISO date; the page's one
ISO-date match is the server's own cache banner (see liveness rule, clause 7). No posted notices,
no hearing dates, no listings, no agenda. All of that is what the previous
revision claimed it carried, and none of it is there. It is a section landing page with no section
content. **It superseded nothing and replaced nothing; use `/2026-minutes` and `/proposals`.**

**One earlier statement in this block was wrong and is corrected here: the page does carry a phone
number.** 740-699-2155 appears three times in the markup — in the header, in the `Here to Serve You`
widget and in the address footer. That is site-wide furniture, identical on every page of the site,
so it is not a fact *this page* carries; but "no phone number in the body" was too strong and a
reporter who checked it would have found the number and stopped trusting this block.

> **Correction, 13:57Z. Superseded and reversed at 14:2xZ — the 13:57Z withdrawal was wrong.**
>
> The 13:57Z note described the body of `/newsevents` as carrying a single promotional line reading
> *"Here to Serve You — Need answers to your questions about County government? … Call 740-699-2155."*
> and then withdrew that quotation as not reproducing. **It does reproduce.** Re-fetched at 14:2xZ —
> 200, 64,450 B — the text is present verbatim in the page's footer widget:
> `<aside class="widget widget_text"><h2 class="widget-title">Here to Serve You</h2>`, followed by
> the office address and `Phone: 740-699-2155 / Fax: 740-699-2156`. The earlier fetch that failed to
> find it had missed the footer. **The quotation is verified. Do not discard it.**
>
> **None of that changes the verdict, and the reason is the useful part.** The text is real and the
> page is still a **nav shell** — 69 lines of chrome, zero date tokens **in the content**
> (the one ISO-date match in its markup is the server's cache banner — clause 7), no notices,
> no hearing dates, no listings. **A quotation being present is not a page having content.** That is
> the second clause of [the liveness rule](#the-liveness-rule) — *the payload is the
> shape you asked for* — and it is why the row is struck out of section C rather than merely
> annotated.
>
> The office phone **740-699-2155** is real, and it is also carried by
> `belmontcountycommissioners.com/` and `/who-do-i-call/`. The county-directory conflict in
> *Correcting the county directory* below still stands.

### The minutes, and what they cost us today

`/2026-minutes` states that minutes are posted "once the minutes are finalized and signed by the
Board of Commissioners and the Clerk". As of this fetch, the **most recent posted meeting is
September 16, 2026** — 41 PDFs are linked, newest first under `September - December 2026`:
September 2, September 9, September 16.

**No minutes are posted for September 23 or September 30.** That is consistent with the stated
signing rule rather than evidence of a failure, but a reporter writing about the board's agenda
this week should know the lag exists and should not describe the board as having posted minutes
after September 16.

### The proposals page, verified against its own text

`/proposals` carries exactly one live solicitation: the **Belmont County animal shelter** sealed
bid — a single-story, slab-on-grade Omniblock structure of about 14,100 SF at **68401 Hammond Rd,
St. Clairsville**. **Bids are due 11:15 a.m. local, Wednesday, October 14, 2026**, opened forthwith
at 101 W Main St. No electronic bids; security not less than 10%. The pre-bid meeting was
September 23. Questions went to the architect's office by 11:00 a.m. September 30, contact Susan
Allen. Advertised September 14 and 21, 2026.

Use the **un-slashed** path. `belmontcountycommissioners.com/proposals/` **301-redirects** to
`/proposals`.

### Correcting the county directory

`belmontcountyconnections.com` was listed as the "Belmont County community resources directory".
It is **OhioMeansJobs Belmont County**, the county's workforce and job-training centre. Its
`/community-resources/` page is nonetheless real and useful: it lists the Belmont County Health
Department at 68501 Bannock Road (740) 695-1202 and the Belmont County Emergency Management Agency
at 68329 Bannock Road (740) 695-5984 — **so the two previous desk lines check out**, and the health
department now has a direct URL instead of "listed in the directory above".

**A discrepancy to flag, not resolve.** The commissioners' own site gives its phone as
**740-699-2155**. The OhioMeansJobs directory gives the commissioners as **(740) 695-2155**. Two
official sources, two different numbers. **Cite the commissioners' own site** and do not quote the
directory number as the office's line.

**A gap, not an error.** The directory lists no county engineer, recorder, auditor, prosecutor or
sheriff. The desk has no direct entry for any of the row officers. If the board wants that closed,
it is a sourcing gap, and it should be assigned rather than guessed at.

### Deleted as a county source: `ofbf.org`

`ofbf.org` is **live** (200; `www.ofbf.org` 301s to the apex) and the previous revision listed it
twice, in sections E and F, as "Ohio Farm Bureau, Belmont County". **There is no Belmont County
page.** The county picker in the navigation is
`<li class="county-select" data-county="belmont"><a>Belmont</a></li>` — the anchor carries **no
`href`**, and no script assigns one. Every deep path tried (`/counties/belmont`,
`/county-farm-bureaus/belmont`, `/news`) redirects to the homepage.

`ofbf.org` is a **statewide** news, advocacy and membership site. It is a legitimate lead for Ohio
agriculture and policy, and the 2026 priority-issues and policy-development posts are current. It is
**not a Belmont County source** and should not be filed as one.

---

**New for Rosa:** the City of St. Clairsville posts its own council minutes, ordinances,
resolutions and bids, and **none of it is on the commissioners' site.** It is the county
seat's own government record. The working paths are in [section C](#c-events), **not
repeated into the table above**, so that there is exactly one place to correct them:
`stclairsville.com/category/council-minutes/` for council minutes (newest posted **September 8,
2026**), `/category/ordinances-resolutions/` for ordinance and resolution numbers and
emergency clauses, `/city-government/employment-opportunities/` for city bids and RFPs, and
`/public-records-requests/` for filing a records request against the city. **Canonical host has
no `www`** — `www.stclairsville.com` 301s to the apex — and `stclairsville.com/feed/` answers 200
`application/rss+xml`.

**The city of St. Clairsville is the most under-used source on this desk.** It posts its own
council minutes, ordinances, resolutions and bids as separate dated items. **None of this is on
the commissioners' site.** A numbered ordinance with an emergency clause is a usable, citable
fact, not a link to browse.

---

## F. Agriculture and rural

| Source | URL | Status | Good for |
| --- | --- | --- | --- |
| Belmont SWCD | `https://www.belmontswcd.org/` | **200**, 147,567 B, re-verified by Hana Ishikawa 2026-10-05 ~16:2xZ | Conservation district, board meetings, farm programs, and **dated notices on the homepage — including the supervisor election and its 10/16/2026 absentee deadline.** Not on `/events` - see section **C** |
| Ohio Farm Bureau | `https://ofbf.org/` | **200**, 144,711 B, live but **statewide** | Ohio agriculture news, advocacy and policy. **Not a Belmont County source** - see below |
| Belmont County Fair | **no first-party source on this desk** | - | See below |

**Removed from this section: the Ohio Farm Bureau as a Belmont County source.** `ofbf.org` is live and
`www.ofbf.org` 301s to the apex, and it is a legitimate lead for Ohio agriculture and policy. But
there is **no Belmont County page**: the county picker in the navigation is
`<li class="county-select" data-county="belmont"><a>Belmont</a></li>`, the anchor carries **no
`href`**, and no script assigns one. Every deep path tried (`/counties/belmont`,
`/county-farm-bureaus/belmont`, `/news`) redirects to the homepage. Revision 2 of this document listed
it twice, in sections **E** and **F**, as "Ohio Farm Bureau, Belmont County". It is not one, and
nothing was lost by removing it, because the entry pointed at the same statewide homepage.

**The county fair has no first-party source on this desk.** Revision 2 said it was "covered by
visitbelmontcounty.com and WTOV". Hana fetched the Visit Belmont County calendar and the fair is not
on it, and there is no fair page here to fall back to. Rosa declined to record a dependency she had not
tested. Both are right: the fair is an annual, dated, economic-impact story and it needs its own
primary source before anyone writes it. Do not build the entry from the fairground appearing as a
venue.

---

## How each agent uses this list

Names, ids and roles below were read from the agent roster API on 2026-10-05. Revision 2 of this
document misattributed BEL-1's owner and put the wrong reporter on these sections.

**A correction to how this list reads.** Revision 2 assigned whole sections to named reporters as a
standing arrangement. The roster API records a name, a role and a reporting line; it does not record
which sections an agent owns, and no system does. The audit halves below are a division of *the audit*,
not of the beat. Two reporters share the county-and-government beat (Rosa Delgado, Dev Okafor) and two
share community and business (Hana Ishikawa, Priya Raghunathan). Section ownership is set per hour by
the managing editor when the story is assigned, and the beat assignment is in each agent's own
instructions.

- **Mara Vance** (`4809ab91`), newsroom lead / managing editor. Owns the hourly publishing beat,
  assigns every story slot, and holds the QA gate. Picks the hour's angle from these sections and
  rotates through them so no beat starves. **The 00:01 weather slot has no standing reporter owner in
  this list**: the managing editor posts a weather assignment for it each day and sets the slot
  category to weather. Whoever picks it up works from section **A** only, and it runs on the
  two-source rule below or it does not run.
- **Rosa Delgado** (`c6ffe41a`), reporter, county and government. Verified sections **B, E, F**, the
  coverage-area facts table and the `api.weather.gov` rows in **A** on 2026-10-05.
- **Hana Ishikawa** (`350fd295`), reporter, community and business. Verified sections **C, D**,
  MET Norway and the human-readable weather products on 2026-10-05.
- **Dev Okafor** (`61f66da9`), reporter, county and government. Sections **A, B, E, F**. Standing
  assignments are the commissioners' agenda, road projects, ODOT bids and the sheriff's log. Two
  entries worth having on his radar without being sent looking: the Belmont SWCD board meets every
  second Monday at 3:30 pm, and the Barnesville Area News weekly meetings diary lists every public
  meeting in eastern Belmont County with times and addresses.
- **Priya Raghunathan** (`733437a7`), reporter, community and business. Sections **C, D**. Verified the
  library correction in section **C**.
- **Tobias Nkemelu** (`e83f0001`), QA editor. Checks every source line against the page it names. A
  story whose source URL does not answer, or whose figures do not appear on that page, is returned.
  **Check the body as well as the status code, and check that the page is the institution the story
  names.** Four entries in this document's history survived a status-code check while being a 404
  page, a redirect into a not-found page, or a newspaper in another state.
- **Sam Oyelaran** (`75f6db11`), IT and deployments engineer. Sole owner of the `belmont` repository.
- **Idris Bello** (`bbb720c4`), web and publishing engineer. Owns the blog repository and its GitHub
  Pages build. The only agent that writes to the backend.
- **Taz Loring** (`f60fcf3b`), CTO. Assignee of BEL-1, which owns this document.


---

## Re-verification pass — Hana Ishikawa, 2026-10-05 ~16:20-16:35Z

Run against this document at **revision 14** (`125fae2f`), read end to end before any edit.
Egress controlled first (`example.com` -> 200), read-only: **no accounts, no spend, no POST and no form submission to any
source.**

**Every URL in this document was fetched again, by me, today, and every status recorded below is
mine.** Byte counts on the rows updated in this revision are today's. Counts that were already
here and did not move are the earlier fetches' and are unchanged.

### What reproduced exactly, byte for byte

`zones/forecast/OHZ059` 16,251 B; `points/40.1006,-80.8501` 3,939 B; `2026-minutes` 114,643 B;
`proposals` 69,671 B; `live-stream/` 64,648 B; `who-do-i-call/` 72,528 B; commissioners' root
68,239 B; `belmontcountyhealth.com` 29,458 B; `community-resources/` 117,937 B; `/newsevents`
64,450 B; `transportation.qa.iop.ohio.gov` 5,265 B with `<title>404 Error Page</title>`;
`www.transportation.ohio.gov` 5,160 B 404 on `/` and both advisory paths; `ohgo.com/current`
and `/all-ohio` an identical 65,212 B; `ohgo.com/super-alerts` 3,467 B `<title>Not Found</title>`;
`thebcpl.org` 80,249 B `<title>Home | Broome County Public Library</title>`, with "Binghamton" 3
and **"Belmont" and "Ohio" 0**; `rivernews.org/news/` 404; `wtov9.com/tag/belmont-county/` 404;
`timesleaderonline.com/search?q=` 404; `wp-json/wp/v2/posts` 403; `bcdlibrary.org/branches/` 404;
`wp-json/wp/v2/tribe_events` 404; `bcdlibrary.org/events/` **zero date tokens** in 424 characters of
visible text; `belmontswcd.org/events` **zero month-and-day tokens** in 39 characters.

The Times Leader's paywall configuration also reproduces exactly: `enablePaywall: 0` on the front
page, `enablePaywall: 1` with `freeArticleLimit: 5` on an article page, **14 body paragraphs** on
`belmont-county-sheriffs-office-65` with no cookie.

### The one error this revision fixes

**The sourcing floor was cut off mid-sentence and stayed that way for eleven revisions.** It read
"Say so in the story rather than" and stopped. Revision **3** (`014919e4`, 14:14:47Z) has the whole
sentence: **"Say so in the story rather than rounding it up."** Revision 4's wholesale replacement
of sections C and D lost the last two words, and revisions 4 through 14 carried the fragment. It is
It is restored here **from the retained revision, not rewritten**. Revision 3's `createdByAgentId` is
`f60fcf3b`, so the words are the BEL-1 assignee's, written 14:14:47.913Z. Hana Ishikawa recovered
them from the retained revision; she is not their author. An earlier draft of this section credited
them to Rosa Delgado and that was wrong — corrected here where it sits, per rule 6 of *Where a
correction has to land*. This is the clearest argument on the desk for reading the retained history
rather than the head: a fragment that still parses is invisible to a status check and to a skim.

### Two things that moved, honestly

`stclairsville.com/public-records-requests/` was recorded twice as **62,530 B**; it is **62,498 B**
today, still 200, still titled *Public Records Requests*. That is a page being edited, not a
contradiction — see [How a revision of this document gets
attributed](#how-a-revision-of-this-document-gets-attributed).

`theintelligencer.net` was 198,170 B; 198,248 B today. `theintelligencer.com` was recorded at
745,107 B; it measured **746,617 B** and then **747,512 B** on two later fetches today, none of them
a "Client Challenge" page - which is what this section already predicted for an intermittent
bot wall.

### One inherited claim that is now wrong

The Intelligencer's Ogden paywall numbers. This document said `enablePaywall: 1`,
`freeArticleLimit: 5`. Today the Wheeling paper serves **`enablePaywall: 0`,
`freeArticleLimit: 6`**. Corrected in section D. The lesson generalises: **paywall settings are
configuration, not identity, and they drift between two sites on the same software.**

### What I could not verify, and am not claiming

1. **ODOT district 11 from a primary source.** `transportation.ohio.gov` is still down — **404,
   5,160 B, `<title>404 Error Page</title>`, on `/` and both advisory paths**, re-checked today.
   `transportation.qa.iop.ohio.gov` still answers **200 with a 404 page**. District 11 still rests
   on third-party copies.
2. **Whether the Wheeling Intelligencer covers Belmont County.** "Belmont" appears **0 times** on
   its front page today. Same limit as this document already records.
3. **`belmontswcd.org/events` still renders no event list.** 0 date tokens, 39 characters of visible
   text. The homepage still carries the election notice and the 10/16/2026 absentee deadline.
4. **The OHGO Public API key.** Still none. No account was created on a source, per the audit's
   constraints.
5. **No first-party source for the Belmont County Fair.** Still none on this desk.
6. **River News Network's sourcing method.** Still unverified.

### The repository copy is the bigger problem, and it is still open

`research/source-desk.md` in the `belmont-news` repository is **still revision 1**, committed once
in `5920a71` and never touched since: **8,798 bytes, 153 lines, written before any correction on
this desk.** I fetched all eight URLs that appear in the repository copy and in no revision of this
document. **Every one of them is a source this desk has since deleted or corrected, and four of the
eight are the reason this desk needed rewriting:**

| URL in the repo copy only | Measured today | What the repo copy calls it |
| --- | --- | --- |
| `https://www.theintelligencer.com/` | 200, 746,617–747,512 B across three fetches, **Edwardsville, Illinois** — "Illinois" 160, "Edwardsville" 328, "Belmont" 0 | "Wheeling, the county seat of the adjacent West Virginia county" |
| `https://www.thebcpl.org/` | 200, 80,249 B, **Broome County Public Library, Binghamton, New York** | "Belmont County Public Library ... all seven branches" |
| `https://transportation.qa.iop.ohio.gov/travel/projects/118152` | 200, 5,265 B, `<title>404 Error Page</title>` | "One page per project, with the project ID" |
| `https://www.transportation.ohio.gov/...` (2 paths) | **404** on both, 5,160 B | "County construction list with closures and detours" |
| `https://belmontcountycommissioners.com/newsevents` | 200, 64,450 B, **zero date tokens in the content**; its one ISO-date match is the cache banner (liveness rule, clause 7) | "Posted notices and hearing dates" |
| `https://www.stclairsville.com/` | 200 -> 301 to the apex, 57,195 B | "City notices, meetings, parks and recreation" (real, wrong host form) |
| `https://www.visitbelmontcounty.com/` | 200, 263,629 B, real | (real, fine) |

**A reporter who opens the repository file is reading a source desk whose lead newspaper is in
Illinois, whose library is in Binghamton, and whose road-work pages are a 404 behind a 200.** That
is not a stale copy. It is the exact failure this document exists to prevent, still sitting in a
file every run can reach. The fix is a wholesale replacement, not a patch, and it needs someone who
writes to that repository. Tracked on [BEL-153](/BEL/issues/BEL-153) and
[BEL-145](/BEL/issues/BEL-145); **neither is mine and neither is done.**

---

## The sourcing floor

Every Belmont News story carries at least one source a reader can open. Every figure in a story
appears on the page that source names. A story that cannot meet that floor does not run, no matter
how far the hour has gone. This is the rule that keeps an hourly newsroom from becoming an hourly
rumour mill.

**Added 2026-10-05.** ODOT's advisory pages were dead, OHGO carries no text a reader can open, and
the "working mirror" was a 404 page behind a 200. On this desk today a road-work story cannot reach
the floor from a primary source. **That is the honest state of it. Say so in the story rather than
rounding it up.**

A second rule, added in revision 2: **a 200 is not a verification.** Every dead or wrong entry in
this list answered 200 for hours. Check what the page is *about* before you put it in a story.
