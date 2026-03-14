

# Driver Response Timer + Auto Expiry

## Changes

### 1. `src/hooks/useDispatchEngine.ts`

**Line 78**: Replace `OFFER_EXPIRY_MINUTES = 15` with `OFFER_EXPIRY_SECONDS = 60`

**Line 164**: Change `Date.now() + OFFER_EXPIRY_MINUTES * 60 * 1000` to `Date.now() + OFFER_EXPIRY_SECONDS * 1000`

**After line 119** (before max attempts check): Add a safety check — query existing offers for any with `offer_status = 'pending'`. If one exists, return early without creating a duplicate.

### 2. `src/pages/DriverOffer.tsx`

**Add `useEffect` auto-expiry timer**: A 1-second interval that calculates `secondsRemaining` from `pendingOffer.expires_at`. When it hits 0, sets an `expired` flag and calls `handleExpire(pendingOffer)` automatically.

**Add `useEffect` for stale offers on mount**: If `pendingOffer.expires_at <= now` when the page loads, immediately trigger expiry.

**Replace time display**: Show "Driver Response Timer: Xs remaining" using the `secondsRemaining` state instead of the old minutes+seconds format.

**Remove the "Mark Expired" button** (lines 266-273). Keep Accept and Decline buttons.

**Add `useRef` for expiry guard** to prevent double-firing the expiry handler.

### 3. `src/hooks/useDispatchEngineCompat.ts`

**Line 19**: Change `15 * 60 * 1000` to `60 * 1000` for consistency.

## Result

Offer sent → 60s countdown → auto-expire → next driver. No manual action required.

