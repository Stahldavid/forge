// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=832273aa503a8f94333280bb364ca1b3292cc3b62ae4dfc97aa0eb282ad2f27a
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
        "fieldName": "createdAt",
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
        "fieldName": "tenantId",
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
