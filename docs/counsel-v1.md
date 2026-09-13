# Counsel source contract v1

An opt-in contract for the existing `POST /counsel`, based on API commit
`485937bf58c97e489b107008a25c1ef49c5652cf`. It uses the existing portal JWT,
20-asks-per-IP/10-minute limit, model ladder and API credential path. No new
endpoint, source upload, database, credential, access gate or deployment.

## Source and authority

Only the already tracked server corpus in `src/lib/oaSections.js` is available:

- Document: OA, version `1.9.0`, kind `agreement`, status `review-candidate`.
- Full raw-document SHA-256: `116fa863a49a6e42fbe6579d4dc6b2df966a41a0cf916e3cfe6228facc4b0208`.
- Inherited transcription SHA-256: `02b3ba561b91c5fe1ba5c695e11179ada35d4c3fdba5fced04584472aebbe3c9`.
- Exact extracted-package SHA-256: `d9b108f28d4fb1e3f39f046d880bd484503adbee517645b092bae5712559feca`.

The package digest is SHA-256 of UTF-8 `JSON.stringify({source:
OA_COUNSEL_SOURCE, transcriptionDigest: OA_TRANSCRIPTION_SHA256, sections:
OA_SECTIONS})`, in that key/array order. Each receipt also hashes the exact
section text. The raw-document and transcription hashes are the existing
corpus's provenance chain, not a claim that its extraction is byte-identical
to either original. The extraction and legal prose are unchanged in this patch.

`review-candidate` is deliberately not adopted/executed status. EAP and recorded
founder intent are explicitly unavailable: no new legal corpus, private memory
or transcript text is incorporated. The existing Matlock register remains a
method of explanation, not substantive evidence of the founder's intent.

## Request

```json
{
  "contractVersion": "counsel.v1",
  "sectionId": "oa-s0",
  "subsection": "0.3",
  "selection": null,
  "question": "What does this say?",
  "source": {
    "document": "OA",
    "version": "1.9.0",
    "sourceKind": "agreement",
    "status": "review-candidate",
    "digest": "116fa863a49a6e42fbe6579d4dc6b2df966a41a0cf916e3cfe6228facc4b0208"
  },
  "context": []
}
```

All five source fields must match exactly. No digest prefix or version-only
match. `sectionId` must be the canonical corpus ID, not the numeric alias.
Optional `subsection` is an exact heading reference or the section's own mark;
optional `selection` must occur verbatim inside that scope. Null means the whole
section/no selection. A mismatched rendered selection is refused, never silently
replaced. The inherited refs entry `2.5.3.1` has no exact heading in the extraction;
that narrow request is unavailable until its source boundary is reconciled.

`context` contains at most three chronological `{question, answer, receipt}`
objects. Replay the complete prior V1 receipt shown below, without reducing it
to version/hash. Its source, section, package, prompt version and quoted passages
must still match. Question length is 3–2,000; answer length 1–8,000; selection
length 1–4,000. Unknown keys, versions and receipt-less history are refused.

Receipt matching verifies source association, **not the authenticity of prior
prose**. The API has no signed conversation log. Prior prose remains explicitly
untrusted client data and is sent as JSON data, never interpolated into system
instructions or substituted for agreement evidence. This contract does not
authorize a client to expose another member's conversation.

## Response

Illustrative mocked response shape; this is not a live model answer:

```json
{
  "ok": true,
  "contractVersion": "counsel.v1",
  "answer": "Section 0.3 records that acknowledgement.",
  "support": "cited",
  "section": { "id": "oa-s0", "mark": "0", "title": "source section title" },
  "subsection": "0.3",
  "model": "actual model returned by the service",
  "receipt": {
    "contractVersion": "counsel.v1",
    "corpusDigest": "d9b108f28d4fb1e3f39f046d880bd484503adbee517645b092bae5712559feca",
    "promptVersion": "matlock-source-receipt.v1",
    "verification": "source-and-quote-only",
    "sources": [
      {
        "document": "OA",
        "version": "1.9.0",
        "sourceKind": "agreement",
        "status": "review-candidate",
        "digest": "116fa863a49a6e42fbe6579d4dc6b2df966a41a0cf916e3cfe6228facc4b0208",
        "sourceId": "oa-v1.9.0-review",
        "sectionId": "oa-s0",
        "sectionDigest": "3a253dd384cea9256ba544a053dd3079cbf5ad54d07d652d46e80257fcf25ed2",
        "transcriptionDigest": "02b3ba561b91c5fe1ba5c695e11179ada35d4c3fdba5fced04584472aebbe3c9"
      }
    ],
    "citations": [
      {
        "sourceId": "oa-v1.9.0-review",
        "sectionId": "oa-s0",
        "clause": "0.3",
        "quote": "Each Member acknowledges having reviewed the Certificate of Formation and approves and accepts it."
      }
    ]
  },
  "availability": { "EAP": "unavailable", "founderIntent": "unavailable" }
}
```

The model must return structured `{answer, support, citations}`. `cited` requires
1–8 model-supplied citations. Every quote (8–1,000 exact characters) must occur
inside its named clause and children, or the whole section when `clause:null`.
The route checks this again before issuing a receipt. No fallback attaches the
requested clause to arbitrary prose. Invalid JSON/quotes fail with 502 after the
existing bounded model ladder. V1 allows 1,800 output tokens for prose plus
quotes; legacy keeps 700. No provider calls were made to validate this patch.

`insufficient-source` requires `citations:[]`. The prompt directs the model to
state the missing source plainly instead of answering from memory. Quote checks
do not establish semantic entailment, legal correctness, adoption or personal
advice. UI must not describe the receipt as answer certification or a matched
legal status. Real answer quality and the owner's voice still require evaluation.

## Errors and rollout

- 400: invalid shape/version, `unknown_section`, `unknown_clause`.
- 409: `source_mismatch`, `selection_mismatch`, `history_source_mismatch`.
- 401/429: existing auth/rate refusal.
- 502: `invalid_counsel_citations` or existing provider failure; no answer receipt.

Legacy requests without `contractVersion` preserve their original answer/section/
model/provenance fields, but add `contractVersion:"legacy"`,
`support:"legacy-unverified"`, `receipt:null` and explicit unavailable sources.
Their unsupported `source`/`context` fields remain ignored as before. The old
`provenance` identifies only the retrieved corpus; it does not certify a caller
source or answer. Unknown explicit versions never downgrade to legacy.

The paired Studio caller must opt in explicitly, retain complete receipts with
turns, check exact identity, and display legacy/insufficient support honestly.
Do not mark source provenance merely because any object or version is present.
Do not activate paid asks before the existing Studio admission gate and existing
Worker binding path are independently verified. This API patch neither supplies
that configuration nor broadens Studio admission.

## Local validation

Node 22; no live provider/DB or credentials required:

```sh
node --test test/counselContract.test.js test/counselHttp.test.js test/counselService.test.js
npm test
npm run lint
```

The focused suites exercise exact identity/scope, client history, source-bound
quotes, unsupported answers, legacy output, real HTTP auth/rate middleware and
mocked provider formatting/fallback. Passing them does not establish production,
Cloudflare configuration, paid answer quality, browser integration or adoption.
