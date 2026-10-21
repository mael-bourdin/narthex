/** Tokens of hosted instances: node src/admin.ts issue <label> | revoke <label>. DB as in main.ts. */
import { LeaderboardStore } from "./store.ts";

const [command, label] = process.argv.slice(2);
const store = new LeaderboardStore(process.env.DB ?? "leaderboard.sqlite");
if (command === "issue" && label) console.log(store.issue(label));
else if (command === "revoke" && label) console.log(store.revoke(label) ? "Révoqué." : "Jeton inconnu.");
else console.log("Usage : node src/admin.ts issue <libellé> | revoke <libellé>");
store.close();
