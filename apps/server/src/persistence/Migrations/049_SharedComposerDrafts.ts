import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_composer_drafts (
      draft_key TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      writer_id TEXT NOT NULL,
      content_json TEXT
    )
  `;
});
