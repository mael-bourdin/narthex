/**
 * The Bureau at each level of the company (core `OFFICES`): floor plans in 32 px tiles.
 * A floor lists where each agent sits (`seats`, in order), the furniture, the windows,
 * and, in the tower, the elevator the founder takes between floors.
 */
export type Rect = { x: number; y: number; w: number; h: number };

export type DecoKind =
  | "shelf"
  | "plant"
  | "mattress"
  | "boxes"
  | "bucket"
  | "bulb"
  | "coffee"
  | "board"
  | "water"
  | "sofa"
  | "kitchen"
  | "meeting"
  | "reception"
  | "table";

export interface Deco {
  kind: DecoKind;
  r: Rect;
  /** The founder walks around it. */
  solid: boolean;
}

export interface Seat {
  /** Where the agent stands. */
  x: number;
  y: number;
  /** Their own desk, if they have one (the little house has one table for everyone). */
  desk?: Rect;
}

export interface Floor {
  name: string;
  theme: "t0" | "t1" | "t2" | "t3" | "t4";
  W: number;
  H: number;
  seats: Seat[];
  decos: Deco[];
  windows: { x: number; w: number; kind?: "cracked" | "tall" | "pano" }[];
  door?: Rect;
  rug?: Rect;
  elevator?: Rect;
}

const deco = (kind: DecoKind, x: number, y: number, w = 1, h = 1, solid = true): Deco => ({ kind, r: { x, y, w, h }, solid });

/** A row of desks spread over [from, to], one agent behind each. */
function deskRow(count: number, from: number, to: number, y: number): Seat[] {
  const span = to - from;
  return Array.from({ length: count }, (_, i) => {
    const x = from + Math.round(((i + 0.5) * span) / count) - 1;
    return { x: x + 1, y: y - 1.1, desk: { x, y, w: 2, h: 1 } };
  });
}

export function officeLayout(tier: number, agents: number): Floor[] {
  const n = Math.max(agents, 1);
  switch (tier) {
    case 0: {
      // The run-down little house: one kitchen table for everyone, a mattress, boxes, a bucket under the leak.
      const table = { x: 5, y: 5, w: 4.2, h: 1.4 };
      const around = [5.6, 7.1, 8.6].flatMap((x) => [{ x, y: table.y - 1.1 }, { x, y: table.y + table.h + 1.25 }]);
      return [
        {
          name: "La petite maison",
          theme: "t0",
          W: 14,
          H: 10,
          seats: around.slice(0, Math.max(n, 1)),
          decos: [deco("table", table.x, table.y, table.w, table.h), deco("mattress", 1.3, 6.6, 2.6, 2), deco("boxes", 10.6, 2.3, 2, 1.6), deco("bucket", 12, 4.8, 0.8, 0.8), deco("bulb", 6.7, 2, 0.6, 0.6, false)],
          windows: [
            { x: 2.4, w: 1, kind: "cracked" },
            { x: 10, w: 1 },
          ],
          // The door is off to the side: the founder never walks in onto someone's seat.
          door: { x: 10.4, y: 9, w: 2, h: 1 },
        },
      ];
    }
    case 1:
      return [
        {
          name: "Le petit local",
          theme: "t1",
          W: 18,
          H: 11,
          seats: deskRow(Math.min(n, 6), 2, 14.5, 5.2),
          decos: [deco("board", 2, 0.6, 4, 1, false), deco("coffee", 15.6, 3.6, 1.2, 1.2), deco("water", 15.8, 5.4, 0.9, 1.2), deco("plant", 1.4, 8.6), deco("plant", 15.6, 8.6)],
          windows: [
            { x: 8, w: 1 },
            { x: 11, w: 1 },
          ],
          door: { x: 8, y: 10, w: 2, h: 1 },
        },
      ];
    case 2:
      return [
        {
          name: "Les bureaux en ville",
          theme: "t2",
          W: 22,
          H: 13,
          seats: deskRow(Math.min(n, 8), 3, 19, 5.2),
          decos: [deco("shelf", 2, 2), deco("shelf", 3, 2), deco("shelf", 17, 2), deco("shelf", 18, 2), deco("plant", 7, 2), deco("plant", 14, 2), deco("plant", 2, 10), deco("plant", 19, 10)],
          windows: [3, 7.5, 13.5, 18].map((x) => ({ x, w: 1 })),
          door: { x: 10, y: 12, w: 2, h: 1 },
          rug: { x: 7, y: 7.4, w: 8, h: 2.6 },
        },
      ];
    case 3: {
      const first = Math.min(n, 6);
      return [
        {
          name: "Le plateau",
          theme: "t3",
          W: 28,
          H: 15,
          seats: [...deskRow(first, 2, 18, 5.4), ...deskRow(Math.max(0, Math.min(n - first, 6)), 2, 18, 10)],
          decos: [deco("meeting", 20, 2.4, 6.8, 5.2), deco("sofa", 21, 11.2, 4.4, 1.3), deco("kitchen", 1.4, 12.6, 4.2, 1.2), deco("plant", 19.2, 9), deco("plant", 26.3, 9), deco("plant", 7.5, 12.8)],
          windows: [2, 5, 8, 11, 14, 17, 21, 24].map((x) => ({ x, w: 2, kind: "tall" as const })),
          door: { x: 12, y: 14, w: 2, h: 1 },
        },
      ];
    }
    default: {
      // The tower: reception downstairs, the team upstairs, the founder's floor with the view.
      const elevator = { x: 20.6, y: 1.1, w: 2.2, h: 1.9 };
      const team = Math.max(0, n - 1);
      const upstairs = Math.min(team, 8);
      return [
        {
          name: "Rez-de-chaussée · accueil",
          theme: "t4",
          W: 24,
          H: 13,
          seats: [],
          decos: [deco("reception", 9, 5, 6, 1.4), deco("sofa", 2, 9.4, 4.4, 1.3), deco("plant", 1.4, 3), deco("plant", 18.6, 3), deco("plant", 7.5, 10)],
          windows: [2, 5, 8, 11, 14, 17].map((x) => ({ x, w: 2, kind: "tall" as const })),
          door: { x: 11, y: 12, w: 2, h: 1 },
          elevator,
        },
        {
          name: "1er étage · l'équipe",
          theme: "t4",
          W: 24,
          H: 13,
          seats: [...deskRow(Math.min(upstairs, 4), 2, 18, 5.4), ...deskRow(Math.max(0, upstairs - 4), 2, 18, 9.6)],
          decos: [deco("kitchen", 1.4, 10.4, 4.2, 1.2), deco("plant", 18.8, 9.6), deco("coffee", 16.4, 10.4, 1.2, 1.2)],
          windows: [2, 5, 8, 11, 14, 17].map((x) => ({ x, w: 2, kind: "tall" as const })),
          elevator,
        },
        {
          name: "2e étage · la vue",
          theme: "t4",
          W: 24,
          H: 13,
          // Margaux first, then whoever did not fit upstairs.
          seats: deskRow(1 + Math.max(0, team - upstairs), 4, 14, 6),
          decos: [deco("meeting", 14.6, 7.6, 5.6, 3.6), deco("sofa", 2, 10, 4.4, 1.3), deco("plant", 1.4, 3), deco("plant", 12, 10.6)],
          windows: [{ x: 1, w: 19, kind: "pano" }],
          elevator,
        },
      ];
    }
  }
}

/** Which floor and seat each agent gets, in hiring order; Margaux takes the view in the tower. */
export function seatAgents(floors: Floor[], roles: string[]): { floor: number; seat: Seat }[] {
  if (floors.length === 3) {
    let team = 0;
    return roles.map((r) => {
      if (r === "cofondateur") return { floor: 2, seat: floors[2]!.seats[0]! };
      const i = team++;
      return i < floors[1]!.seats.length ? { floor: 1, seat: floors[1]!.seats[i]! } : { floor: 2, seat: floors[2]!.seats[1 + i - floors[1]!.seats.length]! };
    });
  }
  const seats = floors[0]!.seats;
  // More agents than seats (a crowded little house): the extra ones stand by the wall.
  return roles.map((_, i) => ({ floor: 0, seat: seats[i] ?? { x: 2 + (i % 10) * 1.2, y: floors[0]!.H - 2.2 } }));
}
