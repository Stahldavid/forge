// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=ebaf8355caeb8e9be9e123120ca0efcc484eaa296722c6ac97d854bce2003b51
export const tableMap = {
  "tenants": {
    "tableName": "tenants",
    "columns": [
      {
        "name": "created_at",
        "sqlType": "timestamptz"
      },
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
        "name": "severity",
        "sqlType": "text"
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
      },
      {
        "name": "triage_summary",
        "sqlType": "text"
      },
      {
        "name": "updated_at",
        "sqlType": "timestamptz"
      }
    ],
    "tenantScoped": true,
    "tenantIdColumn": "tenant_id"
  },
  "users": {
    "tableName": "users",
    "columns": [
      {
        "name": "created_at",
        "sqlType": "timestamptz"
      },
      {
        "name": "email",
        "sqlType": "text"
      },
      {
        "name": "id",
        "sqlType": "uuid",
        "primaryKey": true
      },
      {
        "name": "role",
        "sqlType": "text"
      },
      {
        "name": "tenant_id",
        "sqlType": "uuid"
      }
    ],
    "tenantScoped": true,
    "tenantIdColumn": "tenant_id"
  }
} as const;
