// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=8bf6f79154ce9ca905211af42b8b363ec173d35d3394a322f810f72aa36b8b4a
export const runtimeGraph = {
  "analyzerVersion": "0.1.0",
  "entries": [
    {
      "dependencies": [
        "3dc196a8712ef17838ec5ef02b7329ff943a29f0941c551b94eeca72362ce417"
      ],
      "file": "src/commands/badStripeCommand.ts",
      "id": "e8ec0e9d28065ac2f252fcf405d9f3ce5f45c076aec51d76a2517e3dd9f1187e",
      "kind": "command",
      "moduleId": "b69360748ed1c63064dfdc924debef366aecfe82205fb6f02545a1d9e65563c2",
      "name": "badStripeCommand",
      "qualifiedName": "badStripeCommand",
      "runtimeContext": "command"
    },
    {
      "dependencies": [
        "20d26da38058aafa7c5526f0bb83424b6660c2dcb8a4df9c5510838702aaace0"
      ],
      "file": "src/actions/capturePosthog.ts",
      "id": "ccfd73d342038e78c33e6253f6062dbbbff5baba6c002e92c6e3ca3c4fc139e5",
      "kind": "action",
      "moduleId": "925821af066529cd861897c08e35543a963ed2d0d6f7b2ed2ee6bd39341de3aa",
      "name": "capturePosthog",
      "qualifiedName": "capturePosthog",
      "runtimeContext": "action"
    },
    {
      "dependencies": [],
      "file": "src/actions/captureTicketCreated.ts",
      "id": "94de7c51d9d99e648614b085057fdc41f08c496a4d61e6cd5885b012759516f6",
      "kind": "action",
      "moduleId": "f1b0f1d42704608330486af77d29c76d483ead7d3f985457cdfc8b59b8d931c2",
      "name": "captureTicketCreated",
      "qualifiedName": "captureTicketCreated",
      "runtimeContext": "action"
    },
    {
      "dependencies": [
        "3dc196a8712ef17838ec5ef02b7329ff943a29f0941c551b94eeca72362ce417"
      ],
      "file": "src/actions/createCheckout.ts",
      "id": "e49d71620330da6c7df9e017ebf2e3f150816ffb4443522fbb1fb8f90ec3471b",
      "kind": "action",
      "moduleId": "88013f243641732a6341ba7763aa07f1133ac30e8a2b39aab3cdda4bb1d24bc2",
      "name": "createCheckout",
      "qualifiedName": "createCheckout",
      "runtimeContext": "action"
    },
    {
      "dependencies": [],
      "file": "src/commands/createTicket.ts",
      "id": "9ce1769e06fe6bb452c729de0eb31289857eb6d48d3336bcc53af8ec79ddb226",
      "kind": "command",
      "moduleId": "c26dc30a11c44c4f59dee7ba17a1488f7e41d3785d7671029aa455d2f6685d3c",
      "name": "createTicket",
      "qualifiedName": "createTicket",
      "runtimeContext": "command"
    },
    {
      "dependencies": [],
      "file": "src/commands/manageBilling.ts",
      "id": "5a384aee569b45ccaedc3c1645bcf675565a329390b4a45536f974026554e6ec",
      "kind": "command",
      "moduleId": "feae8a13bd96eca18ffc440467627460e964e63556a94a6e2d20eb751ec87040",
      "name": "manageBilling",
      "qualifiedName": "manageBilling",
      "runtimeContext": "command"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "d38ffcfb01c0bf9928fc4c92eb4f6804857fbcfab2893621a1c62ff75887990a",
  "schemaVersion": "1.0.0"
} as const;
