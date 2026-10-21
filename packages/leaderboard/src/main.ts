/** Starts the leaderboard service: PORT (default 8787), HOST (default 0.0.0.0), DB (default ./leaderboard.sqlite). */
import { LeaderboardStore } from "./store.ts";
import { startLeaderboard } from "./server.ts";

const store = new LeaderboardStore(process.env.DB ?? "leaderboard.sqlite");
const server = await startLeaderboard({ store, port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? "0.0.0.0" });
console.log(`Classement Narthex sur ${JSON.stringify(server.address())}`);
