// Provider policy failures require an operator fix, not another code attempt.
export function restrictedOtpDelivery(detail) {
  if (!/target not allowed for this project/i.test(String(detail || ""))) return null;
  return {
    error: "delivery_restricted",
    message: "Amber can't send a code to this number right now. Please contact Amber support.",
  };
}
