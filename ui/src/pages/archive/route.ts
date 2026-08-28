// The Archive viewer route.
//
// The loader exists only to hand the page the gateway auth token. The page
// fetches Archive data through the plugin route rather than the gateway RPC
// client, because the Archive credential lives in ~/.psyntient/node.key at
// mode 600 and is held daemon-side -- but that plugin route is still
// `auth: "gateway"`, so a plain fetch() from the page needs the same bearer
// token the WebSocket uses. Reading it from location.hash does not work: the
// hash is consumed at boot and gone by the time a user navigates here.
import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import type { ApplicationContext } from "../../app/context.ts";

export type ArchiveRouteData = { authToken: string | null };

export const page = definePage({
  id: "archive",
  path: "/archive",
  loader: (context: ApplicationContext): ArchiveRouteData => ({
    authToken: context.gateway.connection?.token ?? null,
  }),
  component: () =>
    import("./archive-page.ts").then(() => ({
      header: true,
      render: (data: ArchiveRouteData | undefined) =>
        html`<psyntient-archive-page
          .authToken=${data?.authToken ?? null}
        ></psyntient-archive-page>`,
    })),
});
