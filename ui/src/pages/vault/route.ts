// The Vault viewer route.
//
// Same loader shape as the Archive viewer, and for the same reason: the page
// reads through a gateway plugin route rather than the RPC client, and that
// route is `auth: "gateway"`, so a plain fetch() needs the bearer token the
// WebSocket already holds. Reading it from location.hash does not work -- the
// hash is consumed at boot and gone by the time a user navigates here.
//
// Unlike the Archive, nothing here leaves the machine: the Vault is local (or
// a cloud folder the user owns), and the daemon reads it directly.
import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import type { ApplicationContext } from "../../app/context.ts";

export type VaultRouteData = { authToken: string | null };

export const page = definePage({
  id: "vault",
  path: "/vault",
  loader: (context: ApplicationContext): VaultRouteData => ({
    authToken: context.gateway.connection?.token ?? null,
  }),
  component: () =>
    import("./vault-page.ts").then(() => ({
      header: true,
      render: (data: VaultRouteData | undefined) =>
        html`<psyntient-vault-page .authToken=${data?.authToken ?? null}></psyntient-vault-page>`,
    })),
});
