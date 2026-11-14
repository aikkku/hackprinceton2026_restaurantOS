import type { ButtonHTMLAttributes } from "react";

// Firefox restores dynamic disabled states across reloads before hydration.
// React owns these states. Opt out per button without disabling form autofill.
// Firefox supports autocomplete on buttons, but React's button type omits it.
const disableBrowserStateRestore = { autoComplete: "off" } as const;

export function StateButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} {...disableBrowserStateRestore} />;
}
