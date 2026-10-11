import { card1 } from "./card1-price.js";
import { card2 } from "./card2-replay.js";
import { card3 } from "./card3-free-shopping.js";
import { card4 } from "./card4-wrong-item.js";
import { card5 } from "./card5-discovery.js";
import { card6 } from "./card6-injection.js";
import type { Card } from "./card.js";

export const CARDS: Record<string, Card> = { card1, card2, card3, card4, card5, card6 };
