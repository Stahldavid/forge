import { can, command } from "forge/server";

type TableLike = {
  get(id: string): Promise<Record<string, unknown> | null>;
  insert(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<boolean>;
  where(partial: Record<string, unknown>): Promise<Record<string, unknown>[]>;
};

type SeedVendorAccessDemoArgs = {
  reset?: boolean;
};

const ORGS = {
  acme: "11111111-1111-4111-8111-111111111111",
  globex: "22222222-2222-4222-8222-222222222222",
} as const;

const DEMO_BY_TENANT = {
  [ORGS.acme]: {
    organization: { name: "Acme Corp", slug: "acme", plan: "Enterprise" },
    vendors: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        name: "Atlas Identity",
        category: "Identity",
        riskTier: "High",
        ownerEmail: "security@atlas.example",
        status: "In review",
        lastReviewAt: "2026-06-20T10:30:00.000Z",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        name: "Northstar Payroll",
        category: "HRIS",
        riskTier: "Medium",
        ownerEmail: "risk@northstar.example",
        status: "Approved",
        lastReviewAt: "2026-06-12T14:00:00.000Z",
      },
    ],
    requests: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        vendorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        requesterEmail: "maya@acme.example",
        system: "SCIM production tenant",
        businessJustification: "Provisioning access for the new customer success team.",
        status: "Pending",
        reviewedBy: "",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        vendorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        requesterEmail: "owen@acme.example",
        system: "Payroll export SFTP",
        businessJustification: "Quarterly payroll reconciliation.",
        status: "Approved",
        reviewedBy: "riley@acme.example",
        reviewedAt: "2026-06-21T09:15:00.000Z",
      },
    ],
  },
  [ORGS.globex]: {
    organization: { name: "Globex Security", slug: "globex", plan: "Enterprise" },
    vendors: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        name: "Mercury Cloud",
        category: "Infrastructure",
        riskTier: "High",
        ownerEmail: "compliance@mercury.example",
        status: "In review",
        lastReviewAt: "2026-06-18T16:45:00.000Z",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        name: "LedgerWorks",
        category: "Finance",
        riskTier: "Low",
        ownerEmail: "audit@ledgerworks.example",
        status: "Approved",
        lastReviewAt: "2026-06-14T11:20:00.000Z",
      },
    ],
    requests: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
        vendorId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        requesterEmail: "nina@globex.example",
        system: "Admin console",
        businessJustification: "Incident response escalation path.",
        status: "Pending",
        reviewedBy: "",
      },
    ],
  },
} as const;

async function upsertById(table: TableLike, value: Record<string, unknown>) {
  const id = String(value.id);
  const existing = await table.get(id);
  if (existing) {
    return table.update(id, value);
  }
  return table.insert(value);
}

async function deleteWhere(table: TableLike, partial: Record<string, unknown>) {
  const rows = await table.where(partial);
  let deleted = 0;
  for (const row of rows) {
    if (typeof row.id === "string" && await table.delete(row.id)) {
      deleted += 1;
    }
  }
  return deleted;
}

function currentTenantId(ctx: { auth?: { tenantId?: string } }) {
  return ctx.auth?.tenantId ?? ORGS.acme;
}

export const seedVendorAccessDemo = command<SeedVendorAccessDemoArgs, unknown>({
  auth: can("demo:seed"),

  handler: async (ctx, args: SeedVendorAccessDemoArgs = {}) => {
    const tenantId = currentTenantId(ctx);
    const demo = DEMO_BY_TENANT[tenantId as keyof typeof DEMO_BY_TENANT] ?? DEMO_BY_TENANT[ORGS.acme];
    const now = new Date().toISOString();
    const reset = args.reset === true;
    const deleted = reset
      ? {
          auditEvents: await deleteWhere(ctx.db.auditEvents, { tenantId }),
          evidenceItems: await deleteWhere(ctx.db.evidenceItems, { tenantId }),
          accessRequests: await deleteWhere(ctx.db.accessRequests, { tenantId }),
          vendors: await deleteWhere(ctx.db.vendors, { tenantId }),
          organizations: await ctx.db.organizations.delete(tenantId) ? 1 : 0,
        }
      : undefined;

    await upsertById(ctx.db.organizations, {
      id: tenantId,
      ...demo.organization,
      createdAt: now,
      updatedAt: now,
    });

    for (const vendor of demo.vendors) {
      await upsertById(ctx.db.vendors, {
        ...vendor,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const request of demo.requests) {
      await upsertById(ctx.db.accessRequests, {
        ...request,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const vendor of demo.vendors) {
      await upsertById(ctx.db.evidenceItems, {
        id: `${vendor.id.slice(0, -1)}e`,
        tenantId,
        vendorId: vendor.id,
        label: `${vendor.name} SOC 2 report`,
        status: vendor.riskTier === "High" ? "Needs review" : "Accepted",
        source: "Workspace control room",
        collectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.auditEvents.insert({
      tenantId,
      actorEmail: "demo@forgeos.local",
      action: "demo.seed",
      target: demo.organization.slug,
      detail: "Vendor access workspace refreshed",
      createdAt: now,
    });

    return {
      tenantId,
      organization: demo.organization.name,
      reset,
      deleted,
      vendors: demo.vendors.length,
      requests: demo.requests.length,
    };
  },
});
