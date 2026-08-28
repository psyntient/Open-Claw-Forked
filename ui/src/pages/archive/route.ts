// The Archive viewer route.
//
// No loader: the page fetches through the gateway plugin route rather than the
// gateway RPC client, because the Archive credential lives in
// ~/.psyntient/node.key at mode 600 and is held daemon-side. Loading in the
// page also means an unreachable Archive renders an explanation instead of
// failing the route.
import { definePage } from "@openclaw/uirouter";
import { html } from "lit";

export const page = definePage({
  id: "archive",
  path: "/archive",
  component: () =>
    import("./archive-page.ts").then(() => ({
      header: true,
      render: () => html`<psyntient-archive-page></psyntient-archive-page>`,
    })),
});
