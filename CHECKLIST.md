# x402 Payment Agent: Security Checklist

One page. Six questions for the buyer, five for the seller. If you answer "no" to any,
that is an open door. Full detail in [README.md](README.md).

## Buyer side (in `onBeforePaymentCreation`, before signing)

- [ ] **Match the offer.** Does the 402 match the offer the agent chose, on every field:
      amount, `payTo`, `asset`, network? (Card 1)
- [ ] **Know the seller.** Is this seller on an allowlist, with the same domain, wallet
      and coin? Is anything new or changed sent to probation, not paid? (Card 5)
- [ ] **Check the plan.** Was this purchase in a plan made before any seller text was
      read? (Card 6)
- [ ] **Cap and budget.** Is one payment under the per-call cap, and the running total
      under the task budget? (Cards 1, 6)
- [ ] **No task data to strangers.** Does an unknown seller get the request without the
      user's task context? (Card 5)
- [ ] **Retry safely.** On a timeout, does the agent resend the *same* signed payment,
      never a fresh one? (Card 2)

## Seller side (before you deliver)

- [ ] **Settle, then deliver.** For exact payments, do you wait for settle, not just
      "valid"? (Card 3)
- [ ] **Claim each payment once.** Keyed by the nonce, in a shared store, before any
      work? (Card 2)
- [ ] **Bind payment to item.** Does the same payment on a different route get `409`?
      (Card 4)
- [ ] **One gate, every route.** Does every route that returns paid data answer `402`
      without payment? Is this tested on every deploy? (Card 3)
- [ ] **Keep paid replies out of caches.** `no-store` on paid replies, plus a CDN rule
      that skips paid routes? (Card 3)

## The one line to remember

"The payment succeeded" and "the payment was correct" are different assertions. The
facilitator proves the first. Only your code proves the second.

---

Built for `@x402/*` 2.28.0, October 2026. A personal exploration. Check the current
[x402 docs](https://docs.x402.org) before using in production.
