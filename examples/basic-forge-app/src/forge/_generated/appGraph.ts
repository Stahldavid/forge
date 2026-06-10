// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=6230f6259b15a15083cdb3da56150ae6c221972a2b62676019d2efc81194f18b
export const appGraph = {
  "analyzerVersion": "0.1.0+schema:1.0.0+grammar:0.23.2+classifier:0.1.1+tsconfig:e6af6edda9311177476f05f3cf59e18f2429d8628f21e5e42a01ebe27e925448",
  "edges": [],
  "generatorVersion": "0.0.0",
  "inputHash": "9c258e8ab7df3b4d249866224e5a581c64252d182ab64d6d368a76c2596e86c9",
  "moduleGraph": {
    "nodes": [
      {
        "declaredContexts": [
          "query"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 41,
              "start": 27
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/queries/getTicket.ts",
        "id": "038c8c820ad2a11b258c15700c6526cd7d1aff7d68a604f1432ba2507057f7dd",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "posthog-js",
            "span": {
              "end": 32,
              "start": 20
            },
            "specifier": "posthog-js",
            "subpath": ""
          }
        ],
        "effectiveContexts": [],
        "file": "src/lib/posthogClient.ts",
        "id": "147b9474818f7ff9dba61a4be3c1281e8d32937ec013448f281c0cce787671fe",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "posthog-node",
            "span": {
              "end": 38,
              "start": 24
            },
            "specifier": "posthog-node",
            "subpath": ""
          }
        ],
        "effectiveContexts": [],
        "file": "src/lib/posthogServer.ts",
        "id": "20d26da38058aafa7c5526f0bb83424b6660c2dcb8a4df9c5510838702aaace0",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "stripe",
            "span": {
              "end": 27,
              "start": 19
            },
            "specifier": "stripe",
            "subpath": ""
          }
        ],
        "effectiveContexts": [],
        "file": "src/lib/stripeClient.ts",
        "id": "3dc196a8712ef17838ec5ef02b7329ff943a29f0941c551b94eeca72362ce417",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 42,
              "start": 28
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/forge/schema.ts",
        "id": "5e25b5f705f7c3058c237357f418a6c0effc4cc00aac40cd32ecff14329df3cb",
        "localImports": []
      },
      {
        "declaredContexts": [
          "query"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 41,
              "start": 27
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/queries/listTickets.ts",
        "id": "69848f63f7ca63ae2b523a7345c56ad9fbfefba972713968412d67ea1d35a220",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 54,
              "start": 40
            },
            "specifier": "forge/policy",
            "subpath": "/policy"
          }
        ],
        "effectiveContexts": [],
        "file": "src/policies.ts",
        "id": "6e05030c6494caf63b5fd788687d27f653bf7222354f313d4934515784df3812",
        "localImports": []
      },
      {
        "declaredContexts": [],
        "directPackageImports": [],
        "effectiveContexts": [],
        "file": "src/client/demo.ts",
        "id": "7780c27948b924b91b7f84619f162a9e881f68cc2697144ceb21190aa10f6f16",
        "localImports": [
          {
            "span": {
              "end": 70,
              "start": 39
            },
            "toModuleId": "31300e47ba6516d98164469de2bdba418e3421f24133d44db38f2be44685e204"
          }
        ]
      },
      {
        "declaredContexts": [
          "action"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 37,
              "start": 23
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/actions/createCheckout.ts",
        "id": "88013f243641732a6341ba7763aa07f1133ac30e8a2b39aab3cdda4bb1d24bc2",
        "localImports": [
          {
            "span": {
              "end": 86,
              "start": 62
            },
            "toModuleId": "3dc196a8712ef17838ec5ef02b7329ff943a29f0941c551b94eeca72362ce417"
          }
        ]
      },
      {
        "declaredContexts": [
          "action"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 37,
              "start": 23
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/actions/capturePosthog.ts",
        "id": "925821af066529cd861897c08e35543a963ed2d0d6f7b2ed2ee6bd39341de3aa",
        "localImports": [
          {
            "span": {
              "end": 94,
              "start": 69
            },
            "toModuleId": "20d26da38058aafa7c5526f0bb83424b6660c2dcb8a4df9c5510838702aaace0"
          }
        ]
      },
      {
        "declaredContexts": [
          "command"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 38,
              "start": 24
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/commands/badStripeCommand.ts",
        "id": "b69360748ed1c63064dfdc924debef366aecfe82205fb6f02545a1d9e65563c2",
        "localImports": [
          {
            "span": {
              "end": 87,
              "start": 63
            },
            "toModuleId": "3dc196a8712ef17838ec5ef02b7329ff943a29f0941c551b94eeca72362ce417"
          }
        ]
      },
      {
        "declaredContexts": [
          "command"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 43,
              "start": 29
            },
            "specifier": "forge/server",
            "subpath": "/server"
          },
          {
            "importKind": "static",
            "packageName": "zod",
            "span": {
              "end": 68,
              "start": 63
            },
            "specifier": "zod",
            "subpath": ""
          }
        ],
        "effectiveContexts": [],
        "file": "src/commands/createTicket.ts",
        "id": "c26dc30a11c44c4f59dee7ba17a1488f7e41d3785d7671029aa455d2f6685d3c",
        "localImports": []
      },
      {
        "declaredContexts": [
          "liveQuery"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 45,
              "start": 31
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/queries/liveTickets.ts",
        "id": "d12ed153cf5b22762d6bf2974fd6367da48d9b5524c8f790bd6880585c3bc5b3",
        "localImports": []
      },
      {
        "declaredContexts": [
          "workflow"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 52,
              "start": 38
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/workflows/triageTicketWorkflow.ts",
        "id": "ef22a88c3f70a0d01428db42665f8df8007a6d7d6307ccfedfbb43262edf40aa",
        "localImports": []
      },
      {
        "declaredContexts": [
          "action"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 37,
              "start": 23
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/actions/captureTicketCreated.ts",
        "id": "f1b0f1d42704608330486af77d29c76d483ead7d3f985457cdfc8b59b8d931c2",
        "localImports": []
      },
      {
        "declaredContexts": [
          "command"
        ],
        "directPackageImports": [
          {
            "importKind": "static",
            "packageName": "forge",
            "span": {
              "end": 43,
              "start": 29
            },
            "specifier": "forge/server",
            "subpath": "/server"
          }
        ],
        "effectiveContexts": [],
        "file": "src/commands/manageBilling.ts",
        "id": "feae8a13bd96eca18ffc440467627460e964e63556a94a6e2d20eb751ec87040",
        "localImports": []
      }
    ]
  },
  "schemaVersion": "1.0.0",
  "symbols": [
    {
      "contentHash": "a7d3f5ab91b48d9b0408d24f3b1c98231dc03194ebe7a005a2779c7e33d5b688",
      "file": "src/actions/capturePosthog.ts",
      "id": "ccfd73d342038e78c33e6253f6062dbbbff5baba6c002e92c6e3ca3c4fc139e5",
      "kind": "action",
      "meta": {
        "exportPath": "",
        "fileContentHash": "17665160a07edcd5b41d2eeb558fa2197ed3143b6ca05849f0d38b0c56521923",
        "sourceSlice": "action(async () => {\n  return posthogServer;\n})"
      },
      "name": "capturePosthog",
      "qualifiedName": "capturePosthog",
      "span": {
        "end": 174,
        "start": 127
      }
    },
    {
      "contentHash": "9b7c4613d63a26e93b2ef7aeb778348572389b9513f29dcf36f108c72fe640ce",
      "file": "src/actions/captureTicketCreated.ts",
      "id": "94de7c51d9d99e648614b085057fdc41f08c496a4d61e6cd5885b012759516f6",
      "kind": "action",
      "meta": {
        "exportPath": "",
        "fileContentHash": "b0f2cda990b26f97f210a206dbe882e766662fb7aad30a5b8aea8d3501839e50",
        "sourceSlice": "action({\n  event: \"ticket.created\",\n  handler: async (ctx, event: { id: string; title?: string; status?: string; traceId?: string }) => {\n    await ctx.telemetry.capture(\"ticket_created_action\", {\n      ticketId: event.id,\n      traceId: event.traceId,\n    });\n\n    const ticket = await ctx.db.tickets.get(event.id);\n    return {\n      captured: true,\n      ticketId: event.id,\n      title: ticket?.title ?? event.title ?? null,\n    };\n  },\n})"
      },
      "name": "captureTicketCreated",
      "qualifiedName": "captureTicketCreated",
      "span": {
        "end": 519,
        "start": 76
      }
    },
    {
      "contentHash": "854f3c80379e41a180d047d4f935f6c0ea6f4fd5d880602c14d4465b88776bb5",
      "file": "src/actions/createCheckout.ts",
      "id": "e49d71620330da6c7df9e017ebf2e3f150816ffb4443522fbb1fb8f90ec3471b",
      "kind": "action",
      "meta": {
        "exportPath": "",
        "fileContentHash": "ebc099a053279b1c6cdc6f66bb3da58805f51b8eaddd07e1fa2776fcb28a16bd",
        "sourceSlice": "action(async () => {\n  return stripe.checkout;\n})"
      },
      "name": "createCheckout",
      "qualifiedName": "createCheckout",
      "span": {
        "end": 168,
        "start": 119
      }
    },
    {
      "contentHash": "2cb536fdd34bf4f7df8d07630966222ad644bc8cf708f9e31cb505355ea694f7",
      "file": "src/commands/badStripeCommand.ts",
      "id": "e8ec0e9d28065ac2f252fcf405d9f3ce5f45c076aec51d76a2517e3dd9f1187e",
      "kind": "command",
      "meta": {
        "exportPath": "",
        "fileContentHash": "ba72bbf947a5c8a0b6f6f18cd2d1a05269529ff8d139d2f92f34f27c26a8c6b5",
        "sourceSlice": "command(async () => {\n  return stripe;\n})"
      },
      "name": "badStripeCommand",
      "qualifiedName": "badStripeCommand",
      "span": {
        "end": 163,
        "start": 122
      }
    },
    {
      "contentHash": "c904be01c75611a03528a57505b221bdefcf602190d8cdd2612aa5b68dc7e3aa",
      "file": "src/commands/createTicket.ts",
      "id": "9ce1769e06fe6bb452c729de0eb31289857eb6d48d3336bcc53af8ec79ddb226",
      "kind": "command",
      "meta": {
        "exportPath": "",
        "fileContentHash": "bdee5c858f0543cff6dd08a1fb4a58e9da5d9467e93f8bed99e57d81ba5368c1",
        "sourceSlice": "command({\n  auth: can(\"tickets.create\"),\n  handler: async (ctx, args) => {\n    const parsed = ticketSchema.parse(args);\n    await ctx.telemetry.capture(\"ticket_create_started\", {\n      title: parsed.title,\n    });\n\n    const row = await ctx.db.tickets.insert({\n      title: parsed.title,\n      status: parsed.status ?? \"open\",\n    });\n\n    await ctx.telemetry.capture(\"ticket_created\", {\n      ticketId: row.id,\n      title: row.title,\n    });\n\n    await ctx.emit(\"ticket.created\", {\n      id: row.id,\n      title: row.title,\n      status: row.status,\n    });\n\n    return row;\n  },\n})"
      },
      "name": "createTicket",
      "qualifiedName": "createTicket",
      "span": {
        "end": 801,
        "start": 217
      }
    },
    {
      "contentHash": "4b8728fde61cb126916ca285bfc73d3a55fcbef406c06dcfe12eb08e12b7481b",
      "file": "src/commands/manageBilling.ts",
      "id": "5a384aee569b45ccaedc3c1645bcf675565a329390b4a45536f974026554e6ec",
      "kind": "command",
      "meta": {
        "exportPath": "",
        "fileContentHash": "2f2483af4cd4fa1b968c68b967b06ee8bb109bd1e5e46b88b90fef72e1a43582",
        "sourceSlice": "command({\n  auth: can(\"billing.manage\"),\n  handler: async (ctx) => {\n    return { ok: true, tenantId: ctx.auth.kind === \"user\" ? ctx.auth.tenantId : null };\n  },\n})"
      },
      "name": "manageBilling",
      "qualifiedName": "manageBilling",
      "span": {
        "end": 239,
        "start": 75
      }
    },
    {
      "contentHash": "f37c1512d37dbdf0dc0bd8c07512b7e14b56289d977adcd71edc015f6b48d120",
      "file": "src/queries/liveTickets.ts",
      "id": "f0ec05ae27f05d878b9857863da6013269c57f29f07d4b2f3b59ea84d5878ff5",
      "kind": "liveQuery",
      "meta": {
        "exportPath": "",
        "fileContentHash": "ecaf5ddf72cd63058a2056d170d7764ce5ccef9028d2f5c65d2f897d5ff27de6",
        "sourceSlice": "liveQuery({\n  auth: can(\"tickets.read\"),\n  handler: async (ctx) => {\n    return ctx.db.tickets.where({ status: \"open\" });\n  },\n})"
      },
      "name": "liveTickets",
      "qualifiedName": "liveTickets",
      "span": {
        "end": 204,
        "start": 75
      }
    },
    {
      "contentHash": "2571682cc7de088e316b7c58f999a92d2f6f7be69e3c5f2555f7f44bb3c44b89",
      "file": "src/policies.ts",
      "id": "e8dbd644a8a56f31a4019feb122c891dfd4d81220563ca7c0d38233a5fd54833",
      "kind": "policy",
      "meta": {
        "exportPath": "",
        "fileContentHash": "992a12cd95790363eb5e0e16bcdf819d24e9af99a506abf6ff9434e5284862a2",
        "sourceSlice": "definePolicies({\n  \"tickets.read\": canRole(\"owner\", \"admin\", \"member\"),\n  \"tickets.create\": canRole(\"owner\", \"admin\", \"member\"),\n  \"billing.manage\": canRole(\"owner\", \"admin\"),\n})"
      },
      "name": "policies",
      "qualifiedName": "policies",
      "span": {
        "end": 259,
        "start": 81
      }
    },
    {
      "contentHash": "665033aeeeff6c3e0c89384ab939dd314b4ba7dc8e6b24bc709b25a8074d48bd",
      "file": "src/queries/getTicket.ts",
      "id": "1e727ed1e784d7d51df4f835bf7089d854c5ca6b9b41951f60fa02524eb1add8",
      "kind": "query",
      "meta": {
        "exportPath": "",
        "fileContentHash": "fcf9e0546c0350ac158dbb4a4da4c88004f015a1d839868cb7e2206599ba97d5",
        "sourceSlice": "query({\n  auth: can(\"tickets.read\"),\n  handler: async (ctx, args: { id: string }) => {\n    return ctx.db.tickets.get(args.id);\n  },\n})"
      },
      "name": "getTicket",
      "qualifiedName": "getTicket",
      "span": {
        "end": 203,
        "start": 69
      }
    },
    {
      "contentHash": "c1df954d222445530ddd6db895fd04d8d2a6ab37b8bb3e8935e3d3e944e5bf70",
      "file": "src/queries/listTickets.ts",
      "id": "b0a3ac02fbd7892a43ea9251936f3b3922249effde56636319d550480d443c28",
      "kind": "query",
      "meta": {
        "exportPath": "",
        "fileContentHash": "63834800b7f64a81733b18ad1f9bf856ce8161fd318779f3e165cd28c8ced6e8",
        "sourceSlice": "query({\n  auth: can(\"tickets.read\"),\n  handler: async (ctx) => {\n    return ctx.db.tickets.all();\n  },\n})"
      },
      "name": "listTickets",
      "qualifiedName": "listTickets",
      "span": {
        "end": 176,
        "start": 71
      }
    },
    {
      "contentHash": "11aae6296ef8959c58a33400b9e797378b0b7c7f6650de40e49bc61226372ffa",
      "file": "src/forge/schema.ts",
      "id": "924a402113e813c40a61d6e4953fa038b61f42c98ca1fa981551e409361e10fa",
      "kind": "schema.table",
      "meta": {
        "exportPath": "",
        "fileContentHash": "be9efc3f7679944157e273a1f8685dbfca43899596c5f55370cd4c22507610e4",
        "sourceSlice": "defineTable({\n  name: \"tenants\",\n  fields: {\n    id: \"uuid\",\n    name: \"text\",\n  },\n})"
      },
      "name": "tenants",
      "qualifiedName": "tenants",
      "span": {
        "end": 154,
        "start": 68
      }
    },
    {
      "contentHash": "966fa5037ad9445aef59566ff07732be023f5f43cc86db8ee4fd225714dd1e2a",
      "file": "src/forge/schema.ts",
      "id": "417ad2432a2d63524c1ed383358088600dc7f083dfb7bf8d46aade1518c2e89e",
      "kind": "schema.table",
      "meta": {
        "exportPath": "",
        "fileContentHash": "be9efc3f7679944157e273a1f8685dbfca43899596c5f55370cd4c22507610e4",
        "sourceSlice": "defineTable({\n  name: \"tickets\",\n  fields: {\n    id: \"uuid\",\n    tenantId: \"ref:tenants\",\n    title: \"text\",\n    status: \"enum:open,pending,closed\",\n    createdAt: \"timestamp\",\n  },\n})"
      },
      "name": "tickets",
      "qualifiedName": "tickets",
      "span": {
        "end": 364,
        "start": 180
      }
    },
    {
      "contentHash": "3c70fd87f4f42adef58e9ae4c91151b665eba476516eb62bdf058e0abdcd7b60",
      "file": "src/workflows/triageTicketWorkflow.ts",
      "id": "bf2312cc6a628448ad8c940452c76c3c571159716fe30f73831865fcf5fcb84f",
      "kind": "workflow",
      "meta": {
        "exportPath": "",
        "fileContentHash": "3274eb9b713d1769939cf34de0e9c8ba1bc13a519a7fc8e54240e5579dfe1d7d",
        "sourceSlice": "workflow({\n  trigger: event(\"ticket.created\"),\n  steps: [\n    step(\"loadTicket\", async (ctx) => {\n      const span = await ctx.telemetry.span(\"loadTicket\");\n      try {\n        const input = ctx.input as { id: string };\n        const ticket = await (ctx.db.tickets as { get: (id: string) => Promise<unknown> }).get(\n          input.id,\n        );\n        return { ticket };\n      } finally {\n        await span.end();\n      }\n    }),\n    step(\"triageWithAI\", async (ctx) => {\n      const loaded = ctx.steps.loadTicket?.output as { ticket: { title: string } };\n      const result = await ctx.ai.generateText({\n        provider: \"openai\",\n        model: \"gpt-4o-mini\",\n        prompt: `Triage ticket: ${loaded.ticket.title}`,\n        purpose: \"ticket_triage\",\n      });\n      const priority = result.text.toLowerCase().includes(\"urgent\") ? \"high\" : \"normal\";\n      return {\n        priority,\n        model: result.model,\n        usage: result.usage,\n      };\n    }),\n    step(\"captureTriageAnalytics\", async (ctx) => {\n      const triage = ctx.steps.triageWithAI?.output as {\n        priority: string;\n        model: string;\n        usage: { totalTokens: number };\n      };\n      await ctx.telemetry.capture(\"workflow_ticket_triaged\", {\n        traceId: ctx.telemetry.traceId,\n        priority: triage.priority,\n        model: triage.model,\n        tokens: triage.usage?.totalTokens,\n      });\n      return { captured: true, priority: triage.priority };\n    }),\n  ],\n})"
      },
      "name": "triageTicketWorkflow",
      "qualifiedName": "triageTicketWorkflow",
      "span": {
        "end": 1558,
        "start": 91
      }
    }
  ]
} as const;
