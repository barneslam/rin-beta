// Centralized payment timing thresholds (minutes)
// Adjust these values to change payment timeout behavior across the app.

/** Minutes before a payment_authorization_required job shows a warning in dispatcher UI */
export const PAYMENT_WARNING_MINUTES = 15;

/** Minutes before a payment_authorization_required job is auto-expired by the timeout function */
export const PAYMENT_EXPIRY_MINUTES = 30;
