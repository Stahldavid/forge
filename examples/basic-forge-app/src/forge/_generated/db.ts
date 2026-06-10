// @forge-generated generator=0.0.0 input=dbed69e6d72dbc70c4da980e189c370546d6773f069f0b210a3b192dab421887 content=6b553a5a6ef32e20b0445282243953224a617b1bb4d8ac3a785d3ae3912419ff
export const tableMap = {
  "tenants": {
    "tableName": "tenants",
    "columns": [
      {
        "name": "id",
        "sqlType": "uuid",
        "primaryKey": true
      }
    ]
  },
  "tickets": {
    "tableName": "tickets",
    "columns": [
      {
        "name": "created_at",
        "sqlType": "timestamptz"
      },
      {
        "name": "id",
        "sqlType": "uuid",
        "primaryKey": true
      },
      {
        "name": "status",
        "sqlType": "text"
      },
      {
        "name": "tenant_id",
        "sqlType": "uuid"
      },
      {
        "name": "title",
        "sqlType": "text"
      }
    ],
    "tenantScoped": true,
    "tenantIdColumn": "tenant_id"
  }
} as const;
