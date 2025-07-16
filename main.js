require('dotenv').config({ quiet: true });
const express = require('express'); // Import express

const { Client, GatewayIntentBits, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Constants for inventory and pagination
const MAX_INVENTORY_SIZE = 200;
const ITEMS_PER_PAGE = 10; // Number of items to display per inventory page
const petRestockInterval = 30 * 60 * 1000; // Define petRestockInterval globally
const NOTIFICATION_CHANNEL_ID = '1394736346337251579'; // Channel for notifications

// Admin ID for permission checks
const ADMIN_ID = '722463127782031400';

// Simple seeded PRNG (Linear Concentrated Generator)
function seededRandom(seed) {
  let state = seed;
  return function() {
    state = (1103515245 * state + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function mathRandom(min, max) {
  return Math.floor(min + (max - min) * Math.random());
}

// Function to generate a random alphanumeric special code
// This code is intended to be unique for each harvested plant and pet.
function generateSpecialCode(length = 6) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function calculateWeight(seed, plantName) {
  const plant = plants[plantName];
  if (!plant) return [0, 0];

  const baseWeight = plant.baseWeight;
  const luckChance = plant.luckChance;

  const rand = seededRandom(seed);
  let multiplier = rand() * (1400 - 700) + 700 * 0.001; // 0.7 to 1.4

  if (mathRandom(1, luckChance) === 1) {
    const luckyBoost = mathRandom(3, 4); // 3 or 4
    multiplier *= luckyBoost;
  }

  const weight = baseWeight * multiplier;
  return [weight, multiplier];
}

// Debugging environment variables
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Missing');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Set' : 'Missing');
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? 'Set' : 'Missing');

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in .env file');
}
if (!process.env.DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN must be set in .env file');
}

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions],
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// --- Web Server Setup ---
const app = express();
const port = process.env.PORT || 3000; // Render provides PORT env var

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});
// --- End Web Server Setup ---


// Plant data with stock quantities, baseWeight, and luckChance
const plants = {
  carrot: { rarity: 'Common', growthTime: 60, sellPrice: [15], cost: 10, restockChance: 1, maxStock: 25, multiHarvest: false, baseWeight: 0.5, luckChance: 100 },
  strawberry: { rarity: 'Common', growthTime: 60, sellPrice: [14], cost: 50, restockChance: 1, maxStock: 6, multiHarvest: true, baseWeight: 0.2, luckChance: 100 },
  blueberry: { rarity: 'Uncommon', growthTime: 300, sellPrice: [18], cost: 400, restockChance: 1, maxStock: 5, multiHarvest: true, baseWeight: 0.1, luckChance: 80 },
  orange_tulip: { rarity: 'Uncommon', growthTime: 300, sellPrice: [767], cost: 600, restockChance: 1/3, maxStock: 25, multiHarvest: false, baseWeight: 0.3, luckChance: 80 },
  tomato: { rarity: 'Rare', growthTime: 600, sellPrice: [27], cost: 800, restockChance: 1, maxStock: 3, multiHarvest: true, baseWeight: 0.4, luckChance: 60 },
  corn: { rarity: 'Rare', growthTime: 600, sellPrice: [1500], cost: 1300, restockChance: 1/3, maxStock: 5, baseWeight: 0.8, luckChance: 60, multiHarvest: true }, // NEW PLANT
  daffodil: { rarity: 'Rare', growthTime: 600, sellPrice: [903], cost: 1000, restockChance: 1/7, maxStock: 7, multiHarvest: false, baseWeight: 0.3, luckChance: 60 },
  watermelon: { rarity: 'Rare', growthTime: 600, sellPrice: [2708], cost: 2500, restockChance: 1/8, maxStock: 7, multiHarvest: false, baseWeight: 5, luckChance: 50 },
  pumpkin: { rarity: 'Legendary', growthTime: 1200, sellPrice: [3069], cost: 3000, restockChance: 1/10, maxStock: 4, multiHarvest: false, baseWeight: 4, luckChance: 50 },
  apple: { rarity: 'Legendary', growthTime: 1200, sellPrice: [248], cost: 3250, restockChance: 1/14, maxStock: 3, multiHarvest: true, baseWeight: 0.3, luckChance: 50 },
  bamboo: { rarity: 'Legendary', growthTime: 1200, sellPrice: [3610], cost: 4000, restockChance: 1/5, maxStock: 20, multiHarvest: false, baseWeight: 1, luckChance: 50 },
  coconut: { rarity: 'Mythical', growthTime: 3600, sellPrice: [361], cost: 6000, restockChance: 1/20, maxStock: 2, multiHarvest: true, baseWeight: 1.5, luckChance: 40 },
  cactus: { rarity: 'Mythical', growthTime: 3600, sellPrice: [3069], cost: 15000, restockChance: 1/30, maxStock: 5, multiHarvest: true, baseWeight: 1, luckChance: 40 },
  dragon_fruit: { rarity: 'Mythical', growthTime: 3600, sellPrice: [4287], cost: 50000, restockChance: 1/50, maxStock: 4, multiHarvest: true, baseWeight: 0.4, luckChance: 40 },
  mango: { rarity: 'Mythical', growthTime: 3600, sellPrice: [5866], cost: 100000, restockChance: 1/80, maxStock: 3, multiHarvest: true, baseWeight: 0.5, luckChance: 40 },
  grape: { rarity: 'Divine', growthTime: 7200, sellPrice: [7850], cost: 850000, restockChance: 1/100, maxStock: 1, multiHarvest: true, baseWeight: 0.2, luckChance: 30 },
  mushroom: { rarity: 'Divine', growthTime: 7200, sellPrice: [136278], cost: 150000, restockChance: 1/120, maxStock: 25, multiHarvest: false, baseWeight: 0.3, luckChance: 30 },
  pepper: { rarity: 'Divine', growthTime: 7200, sellPrice: [7220], cost: 1000000, restockChance: 1/140, maxStock: 1, multiHarvest: true, baseWeight: 0.1, luckChance: 30 },
  cacao: { rarity: 'Divine', growthTime: 7200, sellPrice: [10830], cost: 2500000, restockChance: 1/160, maxStock: 1, multiHarvest: true, baseWeight: 0.4, luckChance: 30 },
  beanstalk: { rarity: 'Prismatic', growthTime: 14400, sellPrice: [25270], cost: 10000000, restockChance: 1/210, maxStock: 1, multiHarvest: true, baseWeight: 2, luckChance: 20 },
  ember_lily: { rarity: 'Prismatic', growthTime: 14400, sellPrice: [60166], cost: 15000000, restockChance: 1/240, maxStock: 1, multiHarvest: true, baseWeight: 0.3, luckChance: 20 },
  sugar_apple: { rarity: 'Prismatic', growthTime: 14400, sellPrice: [43320], cost: 25000000, restockChance: 1/290, maxStock: 1, multiHarvest: true, baseWeight: 0.4, luckChance: 20 },
  burning_bud: { rarity: 'Prismatic', growthTime: 14400, sellPrice: [70000], cost: 40000000, restockChance: 1/340, maxStock: 1, multiHarvest: true, baseWeight: 0.3, luckChance: 20 },
  giant_pinecone: { rarity: 'Prismatic', growthTime: 14400, sellPrice: [60000000], cost: 55000000, restockChance: 1/500, maxStock: 1, baseWeight: 5.0, luckChance: 20, multiHarvest: true }, // NEW PLANT
};

// Mutation data
const mutations = {
  gold: { type: 'growth', multiplier: 20, chance: 0.01, pet: 'dragonfly', appearance: 'Golden in color, emits a shimmering sound' },
  rainbow: { type: 'growth', multiplier: 50, chance: 0.001, pet: 'butterfly', condition: '5+ mutations', appearance: 'Continuously changes color, emits yellow particles and a rainbow above it' },
  wet: { type: 'environmental', multiplier: 2, weather: ['rain', 'thunderstorm'], tool: 'sprinkler', pet: 'sea_turtle', appearance: 'Dripping with water particles' },
  windstruck: { type: 'environmental', multiplier: 2, weather: ['windy', 'gale'], appearance: 'Has wind gusts swoop around the crop' },
  moonlit: { type: 'environmental', multiplier: 2, weather: 'night', limit: 6, appearance: 'Glowing, purple aroma, purple in color' },
  clay: { type: 'environmental', multiplier: 3, condition: 'wet + sandy', appearance: 'Brown-ish color with a unique texture' },
  chilled: { type: 'environmental', multiplier: 2, weather: ['frost'], pet: 'polar_bear', appearance: 'Slightly bluish in color, emits frost particles' },
  choc: { type: 'environmental', multiplier: 2, tool: 'chocolate_sprinkler', appearance: 'Brown in color, dripping with chocolate syrup' },
  pollinated: { type: 'environmental', multiplier: 3, weather: ['bee_swarm', 'worker_bee_swarm'], pet: 'bee', appearance: 'Shining, yellow in color, emits yellow gas-like particles' },
  sandy: { type: 'environmental', multiplier: 3, weather: 'sandstorm', appearance: 'Tan color, emits puffs of sand around the fruit' },
  bloodlit: { type: 'environmental', multiplier: 4, weather: 'blood_moon', appearance: 'Shining, red in color' },
  twisted: { type: 'environmental', multiplier: 5, weather: 'tornado', pet: 'pterodactyl', appearance: 'Has tornado-like swirls' },
  drenched: { type: 'environmental', multiplier: 5, weather: 'tropical_rain', replaces: 'wet', appearance: 'Water streaming down, slightly saturated' },
  cloudtouched: { type: 'environmental', multiplier: 5, pet: 'hyacinth_macaw', appearance: 'Emits flashing red glints, cloud-like aura' },
  frozen: { type: 'environmental', multiplier: 10, condition: 'wet/drenched + chilled', pet: 'polar_bear', appearance: 'Encased in an ice block' },
  aurora: { type: 'environmental', multiplier: 90, weather: 'aurora_borealis', appearance: 'Pulses between blues and purples, faint smoke' },
  shocked: { type: 'environmental', multiplier: 100, weather: 'thunderstorm', appearance: 'Neon glow' },
  celestial: { type: 'environmental', multiplier: 120, weather: 'meteor_shower', appearance: 'Slightly reflectant, sparkling yellow and purple' },
  sundried: { type: 'environmental', multiplier: 3, weather: 'heat_wave', appearance: 'Dried and cracked texture' }
};

// Pet data (expanded to include all hatchable pets with default values if not fully defined)
const petsData = {
  starfish: { rarity: 'Common', trait: 'Size Boosters', ability: 'Increases the weight of harvested plants in adjacent garden slots.', baseWeight: 0.1, hungerPerDay: 10, xpToAge: 100, cost: 500 },
  crab: { rarity: 'Common', trait: 'Growth Speed Boosters', ability: 'Reduces the growth time for plants in adjacent garden slots.', baseWeight: 0.2, hungerPerDay: 12, xpToAge: 120, cost: 750 },
  seagull: { rarity: 'Uncommon', trait: 'Resource Gatherers', ability: 'Occasionally grants bonus seeds when harvesting plants.', baseWeight: 0.3, hungerPerDay: 15, xpToAge: 150, cost: 2000 },
  bunny: { rarity: 'Uncommon', trait: 'Mutation Effects', ability: 'Slightly increases the chance for mutations on plants in adjacent garden slots.', baseWeight: 0.15, hungerPerDay: 13, xpToAge: 130, cost: 1800 },
  dog: { rarity: 'Rare', trait: 'Experience Boosters', ability: 'Increases XP gain for other pets in your inventory.', baseWeight: 0.5, hungerPerDay: 20, xpToAge: 200, cost: 5000 },
  golden_lab: { rarity: 'Legendary', trait: 'Special Abilities', ability: 'Rarely grants a "Golden" mutation to a plant in your garden.', baseWeight: 0.6, hungerPerDay: 25, xpToAge: 250, cost: 15000 },
  cat: { rarity: 'Common', trait: 'Size Boosters', ability: 'Boosts the weight of harvested plants in adjacent garden slots.', baseWeight: 0.3, hungerPerDay: 10, xpToAge: 100, cost: 600 },
  orange_tabby: { rarity: 'Uncommon', trait: 'Size Boosters', ability: 'Boosts the weight of harvested plants in adjacent garden slots.', baseWeight: 0.35, hungerPerDay: 12, xpToAge: 120, cost: 2200 },
  moon_cat: { rarity: 'Rare', trait: 'Special Type', ability: 'Night-specific crops in adjacent slots have a chance to replant themselves when harvested.', baseWeight: 0.4, hungerPerDay: 15, xpToAge: 150, cost: 5500 },
  toucan: { rarity: 'Legendary', trait: 'Size Boosters', ability: 'Increases the weight and mutation chance of tropical fruits in adjacent garden slots.', baseWeight: 0.2, hungerPerDay: 18, xpToAge: 180, cost: 18000 },
  blood_hedgehog: { rarity: 'Mythical', trait: 'Size Boosters', ability: 'Increases the weight and mutation chance for prickly fruits in adjacent garden slots.', baseWeight: 0.25, hungerPerDay: 22, xpToAge: 220, cost: 50000 },
  hedgehog: { rarity: 'Rare', trait: 'Size Boosters', ability: 'Increases the weight of prickly fruits in adjacent garden slots.', baseWeight: 0.2, hungerPerDay: 15, xpToAge: 150, cost: 4800 },
  cow: { rarity: 'Common', trait: 'Growth Speed Boosters', ability: 'Reduces the growth time for plants in adjacent garden slots.', baseWeight: 5.0, hungerPerDay: 30, xpToAge: 300, cost: 1000 },
  frog: { rarity: 'Uncommon', trait: 'Growth Speed Boosters', ability: 'Occasionally advances a random plant\'s growth in your garden by one level.', baseWeight: 0.1, hungerPerDay: 10, xpToAge: 100, cost: 2500 },
  echo_frog: { rarity: 'Rare', trait: 'Growth Speed Boosters', ability: 'More frequently advances a random plant\'s growth in your garden by one level.', baseWeight: 0.12, hungerPerDay: 12, xpToAge: 120, cost: 6000 },
  caterpillar: { rarity: 'Common', trait: 'Growth Speed Boosters', ability: 'Boosts the growth rate of leafy plants in adjacent garden slots.', baseWeight: 0.05, hungerPerDay: 8, xpToAge: 80, cost: 400 },
  triceratops: { rarity: 'Legendary', trait: 'Growth Speed Boosters', ability: 'Instantly advances the growth of 3 random plants in your garden by one level.', baseWeight: 10.0, hungerPerDay: 40, xpToAge: 400, cost: 20000 },
  pig: { rarity: 'Rare', trait: 'Variant / Mutation Chance Boosters', ability: 'Temporarily boosts the chance for newly planted seeds to mutate.', baseWeight: 2.0, hungerPerDay: 20, xpToAge: 200, cost: 7000 },
  praying_mantis: { rarity: 'Uncommon', trait: 'Variant / Mutation Chance Boosters', ability: 'Increases mutation chance for plants in adjacent garden slots.', baseWeight: 0.08, hungerPerDay: 10, xpToAge: 100, cost: 1500 },
  snail: { rarity: 'Common', trait: 'Miscellaneous', ability: 'Increases your chance of a lucky harvest (e.g., bonus items or higher quality).', baseWeight: 0.02, hungerPerDay: 5, xpToAge: 50, cost: 300 },
  // Newly added pets from eggData to ensure they have an entry in petsData
  black_bunny: { rarity: 'Uncommon', trait: 'Mutation Effects', ability: 'Slightly increases the chance for mutations on plants in adjacent garden slots.', baseWeight: 0.15, hungerPerDay: 13, xpToAge: 130, cost: 0 },
  chicken: { rarity: 'Common', trait: 'Resource Gatherers', ability: 'Occasionally finds extra seeds when harvesting plants.', baseWeight: 0.5, hungerPerDay: 10, xpToAge: 100, cost: 0 },
  deer: { rarity: 'Uncommon', trait: 'Growth Speed Boosters', ability: 'Reduces the growth time for plants in adjacent garden slots.', baseWeight: 1.0, hungerPerDay: 15, xpToAge: 150, cost: 0 },
  spotted_deer: { rarity: 'Rare', trait: 'Growth Speed Boosters', ability: 'Significantly reduces the growth time for plants in adjacent garden slots.', baseWeight: 1.1, hungerPerDay: 16, xpToAge: 160, cost: 0 },
  rooster: { rarity: 'Rare', trait: 'Miscellaneous', ability: 'Wakes up your plants, providing a small, temporary growth boost to all active garden slots.', baseWeight: 0.7, hungerPerDay: 18, xpToAge: 180, cost: 0 },
  monkey: { rarity: 'Rare', trait: 'Resource Gatherers', ability: 'Occasionally finds extra fruits when harvesting tropical plants.', baseWeight: 0.4, hungerPerDay: 14, xpToAge: 140, cost: 0 },
  silver_monkey: { rarity: 'Legendary', trait: 'Resource Gatherers', ability: 'More frequently finds extra fruits when harvesting tropical plants.', baseWeight: 0.45, hungerPerDay: 15, xpToAge: 150, cost: 0 },
  sea_otter: { rarity: 'Legendary', trait: 'Size Boosters', ability: 'Increases the weight of aquatic plants in adjacent garden slots.', baseWeight: 0.8, hungerPerDay: 20, xpToAge: 200, cost: 0 },
  turtle: { rarity: 'Legendary', trait: 'Growth Speed Boosters', ability: 'Provides a consistent, moderate growth speed boost to all plants in your garden.', baseWeight: 2.0, hungerPerDay: 22, xpToAge: 220, cost: 0 },
  polar_bear: { rarity: 'Legendary', trait: 'Mutation Effects', ability: 'Increases the chance for "Chilled" or "Frozen" mutations on plants in adjacent garden slots during cold weather.', baseWeight: 3.0, hungerPerDay: 25, xpToAge: 250, cost: 0 },
  grey_mouse: { rarity: 'Mythical', trait: 'Resource Gatherers', ability: 'Occasionally finds small amounts of Sheckles when you harvest any plant.', baseWeight: 0.05, hungerPerDay: 5, xpToAge: 50, cost: 0 },
  brown_mouse: { rarity: 'Mythical', trait: 'Resource Gatherers', ability: 'More frequently finds small amounts of Sheckles when you harvest any plant.', baseWeight: 0.06, hungerPerDay: 6, xpToAge: 60, cost: 0 },
  squirrel: { rarity: 'Mythical', trait: 'Resource Gatherers', ability: 'Occasionally finds rare seeds when you harvest plants.', baseWeight: 0.1, hungerPerDay: 8, xpToAge: 80, cost: 0 },
  red_giant_ant: { rarity: 'Mythical', trait: 'Growth Speed Boosters', ability: 'Provides a minor, consistent growth speed boost to all plants in your garden.', baseWeight: 0.03, hungerPerDay: 4, xpToAge: 40, cost: 0 },
  red_fox: { rarity: 'Mythical', trait: 'Miscellaneous', ability: 'Has a chance to scare away pests or negative weather effects from your garden.', baseWeight: 0.7, hungerPerDay: 18, xpToAge: 180, cost: 0 },
  honey_bee: { rarity: 'Bee', trait: 'Mutation Effects', ability: 'Increases the chance for "Pollinated" mutations on flowering plants in adjacent garden slots.', baseWeight: 0.02, hungerPerDay: 3, xpToAge: 30, cost: 0 },
  bear_bee: { rarity: 'Bee', trait: 'Size Boosters', ability: 'Increases the weight of berry-type plants in adjacent garden slots.', baseWeight: 0.08, hungerPerDay: 6, xpToAge: 60, cost: 0 },
  petal_bee: { rarity: 'Bee', trait: 'Growth Speed Boosters', ability: 'Provides a small growth speed boost to flower-type plants in adjacent garden slots.', baseWeight: 0.01, hungerPerDay: 2, xpToAge: 20, cost: 0 },
  queen_bee: { rarity: 'Bee', trait: 'Mutation Effects', ability: 'Significantly increases the chance for "Pollinated" mutations and can attract rare bee-specific mutations.', baseWeight: 0.05, hungerPerDay: 5, xpToAge: 50, cost: 0 },
  ostrich: { rarity: 'Paradise', trait: 'Resource Gatherers', ability: 'Occasionally finds rare and exotic seeds when you harvest plants.', baseWeight: 5.0, hungerPerDay: 30, xpToAge: 300, cost: 0 },
  peacock: { rarity: 'Paradise', trait: 'Mutation Effects', ability: 'Increases the chance for rare and aesthetic mutations on flowering plants.', baseWeight: 1.5, hungerPerDay: 20, xpToAge: 200, cost: 0 },
  capybara: { rarity: 'Paradise', trait: 'Growth Speed Boosters', ability: 'Provides a substantial growth speed boost to all plants in your garden, especially those near water.', baseWeight: 8.0, hungerPerDay: 35, xpToAge: 350, cost: 0 },
  macaw: { rarity: 'Paradise', trait: 'Size Boosters', ability: 'Increases the weight of all tropical fruits in your garden.', baseWeight: 0.3, hungerPerDay: 10, xpToAge: 100, cost: 0 },
  mimic_octopus: { rarity: 'Paradise', trait: 'Miscellaneous', ability: 'Can temporarily mimic the ability of another pet you own, chosen randomly.', baseWeight: 0.8, hungerPerDay: 12, xpToAge: 120, cost: 0 },
};


// Egg data based on provided images and user requirements
const eggData = {
  common_egg: {
    rarity: 'Common',
    cost: 50000,
    hatchTime: 10 * 60 * 1000, // 10 minutes in ms
    shopChance: 1.0, // 100% chance of being in stock
    eggsShop: true,
    hatchablePets: {
      golden_lab: 0.3333,
      dog: 0.3333,
      bunny: 0.3333,
    }
  },
  uncommon_egg: { // Marked unavailable
    rarity: 'Uncommon',
    cost: 150000,
    hatchTime: 20 * 60 * 1000,
    shopChance: 0.54,
    eggsShop: false,
    hatchablePets: {
      black_bunny: 0.25,
      chicken: 0.25,
      cat: 0.25,
      deer: 0.25,
    }
  },
  rare_egg: { // Marked unavailable
    rarity: 'Rare',
    cost: 600000,
    hatchTime: 2 * 60 * 60 * 1000,
    shopChance: 0.24,
    eggsShop: false,
    hatchablePets: {
      orange_tabby: 0.3333,
      spotted_deer: 0.25,
      pig: 0.1667,
      rooster: 0.1667,
      monkey: 0.0833,
    }
  },
  legendary_egg: { // Marked unavailable
    rarity: 'Legendary',
    cost: 3000000,
    hatchTime: 4 * 60 * 60 * 1000,
    shopChance: 0.12,
    eggsShop: false,
    hatchablePets: {
      cow: 0.4255,
      silver_monkey: 0.4255,
      sea_otter: 0.1064,
      turtle: 0.0213,
      polar_bear: 0.0213,
    }
  },
  mythical_egg: {
    rarity: 'Mythical',
    cost: 8000000,
    hatchTime: (5 * 60 + 7) * 60 * 1000, // 5 hours 7 minutes in ms
    shopChance: 0.07,
    eggsShop: true,
    hatchablePets: {
      grey_mouse: 0.3571,
      brown_mouse: 0.2679,
      squirrel: 0.2679,
      red_giant_ant: 0.0893,
      red_fox: 0.0179,
    }
  },
  bug_egg: {
    rarity: 'Bug',
    cost: 50000000,
    hatchTime: 8 * 60 * 60 * 1000, // 8 hours in ms
    shopChance: 0.03,
    eggsShop: true,
    hatchablePets: {
      snail: 0.40,
      giant_ant: 0.30,
      caterpillar: 0.25,
      praying_mantis: 0.04,
      dragonfly: 0.01,
    }
  },
  exotic_bug_egg: { // Marked unavailable (Limited Time Shop)
    rarity: 'Exotic Bug',
    cost: 199,
    hatchTime: 30 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  night_egg: { // Marked unavailable (Twilight Shop/Event)
    rarity: 'Night',
    cost: 50000000,
    hatchTime: (4 * 60 + 10) * 60 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  premium_night_egg: { // Marked unavailable (Lunar Glow Event)
    rarity: 'Premium Night',
    cost: 199,
    hatchTime: 30 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  bee_egg: {
    rarity: 'Bee',
    cost: 30000000, // Changed from 129 to 30,000,000
    hatchTime: (4 * 60 + 10) * 60 * 1000,
    shopChance: 0.06,
    eggsShop: true,
    hatchablePets: {
      bee: 0.65,
      honey_bee: 0.25,
      bear_bee: 0.05,
      petal_bee: 0.04,
      queen_bee: 0.01,
    }
  },
  anti_bee_egg: { // Marked unavailable (Crafting)
    rarity: 'Anti Bee',
    cost: 'Crafting',
    hatchTime: (4 * 60 + 10) * 60 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  premium_anti_bee_egg: { // Marked unavailable (Limited Time Shop)
    rarity: 'Premium Anti Bee',
    cost: 199,
    hatchTime: 30 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  common_summer_egg: {
    rarity: 'Common Summer',
    cost: 1000000,
    hatchTime: 20 * 60 * 1000,
    shopChance: 0.35,
    eggsShop: true,
    hatchablePets: {
      starfish: 0.50,
      seagull: 0.25,
      crab: 0.25,
    }
  },
  rare_summer_egg: { // Marked unavailable
    rarity: 'Rare Summer',
    cost: 25000000,
    hatchTime: 4 * 60 * 60 * 1000,
    shopChance: 0.17,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  },
  paradise_egg: {
    rarity: 'Paradise',
    cost: 50000000,
    hatchTime: (6 * 60 + 40) * 60 * 1000,
    shopChance: 0.07,
    eggsShop: true,
    hatchablePets: {
      ostrich: 0.40,
      peacock: 0.30,
      capybara: 0.21,
      macaw: 0.08,
      mimic_octopus: 0.01,
    }
  },
  // oasis_egg has been removed as requested
  premium_oasis_egg: { // Marked unavailable (Limited Time Shop)
    rarity: 'Premium Oasis',
    cost: 199,
    hatchTime: 30 * 1000,
    shopChance: 0,
    eggsShop: false,
    hatchablePets: {} // No pets provided in image for this one
  }
};


// Weather data
const weatherData = {
  clear: { duration: 3600, emoji: '☀️', color: '#ADD8E6', roleName: 'Clear Weather' },
  rain: { duration: 300, growthBoost: 0.5, mutations: { wet: 0.5 }, next: 1200, emoji: '🌧️', color: '#6495ED', roleName: 'Rain Weather' },
  thunderstorm: { duration: 300, growthBoost: 0.5, mutations: { wet: 0.5, shocked: 0.1 }, replaces: 'rain', chance: 0.1, emoji: '⛈️', color: '#4682B4', roleName: 'Thunderstorm Weather' },
  night: { duration: 600, mutations: { moonlit: 0.2 }, limit: 6, schedule: [530, 930, 1330, 1730, 2130, 2530], emoji: '🌙', color: '#4B0082', roleName: 'Night Weather' },
  blood_moon: { duration: 600, mutations: { bloodlit: 0.25 }, replaces: 'night', chance: 0.3333, limit: 6, emoji: '🌕', color: '#DC143C', roleName: 'Blood Moon Weather' },
  meteor_shower: { duration: 300, mutations: { celestial: 0.05 }, condition: 'night|blood_moon', emoji: '☄️', color: '#8A2BE2', roleName: 'Meteor Shower Weather' },
  windy: { duration: 300, mutations: { windstruck: 0.3 }, emoji: '🌬️', color: '#B0C4DE', roleName: 'Windy Weather' },
  gale: { duration: 300, mutations: { windstruck: 0.5 }, emoji: '💨', color: '#778899', roleName: 'Gale Weather' },
  tornado: { duration: 300, mutations: { twisted: 0.5 }, emoji: '🌪️', color: '#696969', roleName: 'Tornado Weather' },
  sandstorm: { duration: 300, mutations: { sandy: 0.5 }, emoji: '🏜️', color: '#D2B48C', roleName: 'Sandstorm Weather' },
  heat_wave: { duration: 300, mutations: { sundried: 0.5 }, emoji: '🥵', color: '#FF4500', roleName: 'Heat Wave Weather' },
  tropical_rain: { duration: 300, growthBoost: 0.5, mutations: { drenched: 0.5 }, emoji: '☔', color: '#20B2AA', roleName: 'Tropical Rain Weather' },
  bee_swarm: { duration: 300, mutations: { pollinated: 0.5 }, emoji: '🐝', color: '#FFD700', roleName: 'Bee Swarm Weather' }, // New weather type
  worker_bee_swarm: { duration: 300, mutations: { pollinated: 0.75 }, replaces: 'bee_swarm', chance: 0.2, emoji: '🐝', color: '#DAA520', roleName: 'Worker Bee Swarm Weather' } // New weather type
};

// Helper functions
const getRandomQuantity = (rarity) => {
  switch (rarity) {
    case 'Common': return Math.floor(Math.random() * 11) + 10;
    case 'Uncommon': return Math.floor(Math.random() * 6) + 5;
    case 'Rare': return Math.floor(Math.random() * 4) + 2;
    case 'Legendary': return Math.floor(Math.random() * 3) + 1;
    case 'Mythical': return Math.floor(Math.random() * 2) + 1;
    case 'Divine': return 1;
    case 'Prismatic': return 1;
    default: return 1;
  }
};

const getRandomPlants = (currentStock) => {
  const stock = { ...currentStock };

  // Clear current stock of non-guaranteed items to allow for fresh restock chances
  for (const plantName in stock) {
    if (!['carrot', 'strawberry', 'blueberry', 'tomato', 'corn'].includes(plantName)) {
      delete stock[plantName];
    }
  }

  // Guaranteed stock for common plants and corn
  ['carrot', 'strawberry', 'blueberry', 'tomato', 'corn'].forEach((seed) => {
    if (plants[seed]) { // Ensure the plant exists in the plants object
      stock[seed] = Math.min(getRandomQuantity(plants[seed].rarity), plants[seed].maxStock);
    }
  });

  // Independently check restock chance for all other plants
  Object.keys(plants).forEach((plantName) => {
    const plantData = plants[plantName];
    if (!['carrot', 'strawberry', 'blueberry', 'tomato', 'corn'].includes(plantName) && plantData.restockChance > 0) {
      if (Math.random() < plantData.restockChance) {
        stock[plantName] = Math.min(getRandomQuantity(plantData.rarity), plantData.maxStock);
      }
    }
  });

  return stock;
};

// Function to choose a pet based on probabilities for a given egg type
function choosePetToHatch(eggType) {
    const egg = eggData[eggType];
    if (!egg || !egg.hatchablePets || Object.keys(egg.hatchablePets).length === 0) {
        console.error(`No hatchable pets defined for egg type: ${eggType}`);
        return null;
    }

    let cumulativeProbability = 0;
    const rand = Math.random();
    const pets = Object.keys(egg.hatchablePets);

    for (const petName of pets) {
        cumulativeProbability += egg.hatchablePets[petName];
        if (rand < cumulativeProbability) {
            return petName;
        }
    }
    // Fallback in case of rounding errors or probabilities not summing to 1
    return pets[0];
}


const getSellPrice = (plant, level, mutations = [], weight) => {
  // Now directly return the single sellPrice value from the plants object
  // Apply weight multiplier to sell price
  const baseSellPrice = plants[plant].sellPrice[0];
  return baseSellPrice * weight; // Sell price is now multiplied by weight
};

const getEmoji = (itemType, name, level, mutations = []) => {
  if (itemType === 'plant' || itemType === 'harvested_plant' || itemType === 'seed') {
    const baseEmojis = {
      carrot: ['🌱', '🥕', '🥕', '🥕', '🥕'], // Added level 4 emoji (same as 3 for now)
      strawberry: ['🌱', '🍓', '🍓', '🍓', '🍓'],
      blueberry: ['🌱', '🫐', '🫐', '🫐', '🫐'],
      orange_tulip: ['🌱', '🌷', '🌷', '🌷', '🌷'],
      tomato: ['🌱', '🍅', '🍅', '🍅', '🍅'],
      corn: ['🌱', '🌽', '�', '🌽', '🌽'], // NEW PLANT EMOJI
      daffodil: ['🌱', '🌼', '🌼', '🌼', '🌼'],
      watermelon: ['🌱', '🍉', '🍉', '🍉', '🍉'],
      pumpkin: ['🌱', '🎃', '🎃', '🎃', '🎃'],
      apple: ['🌱', '🍎', '🍎', '🍎', '🍎'],
      bamboo: ['🌱', '🎍', '🎍', '🎍', '🎍'],
      coconut: ['🌱', '🥥', '🥥', '🥥', '🥥'],
      cactus: ['🌱', '🌵', '🌵', '🌵', '🌵'],
      dragon_fruit: ['🌱', '🐉', '🐉', '🐉', '🐉'],
      mango: ['🌱', '🥭', '🥭', '🥭', '🥭'],
      grape: ['🌱', '🍇', '🍇', '🍇', '🍇'],
      mushroom: ['🌱', '🍄', '🍄', '🍄', '🍄'],
      pepper: ['🌱', '🌶️', '🌶️', '🌶️', '🌶️'],
      cacao: ['🌱', '🍫', '🍫', '🍫', '🍫'],
      beanstalk: ['🌱', '🌿', '🌿', '🌿', '🌿'],
      ember_lily: ['🌱', '🔥', '🔥', '🔥', '🔥'],
      sugar_apple: ['🌱', '🍏', '🍏', '🍏', '🍏'],
      burning_bud: ['🌱', '🌸', '🌸', '🌸', '🌸'],
      giant_pinecone: ['🌱', '🌳', '🌳', '🌳', '🌳'], // Changed emoji to '🌳'
    };
    const base = baseEmojis[name]?.[level] || '🌱'; // Use optional chaining for safety
    if (mutations.some(m => m.name === 'gold')) return '✨' + base;
    if (mutations.some(m => m.name === 'rainbow')) return '🌈' + base;
    if (mutations.some(m => m.name === 'wet' || m.name === 'drenched')) return '💧' + base;
    if (mutations.some(m => m.name === 'frozen')) return '❄️' + base;
    return base;
  } else if (itemType === 'pet_egg') {
    return '🥚';
  } else if (itemType === 'pet') {
    // Basic pet emojis, can be expanded
    const petEmojis = {
      starfish: '⭐', crab: '🦀', seagull: '🐦', bunny: '🐰', dog: '🐶',
      golden_lab: '🐕', cat: '🐱', orange_tabby: '🐈', moon_cat: '🐈‍⬛',
      toucan: '🦜', blood_hedgehog: '🦔', hedgehog: '🦔', cow: '🐄',
      frog: '🐸', echo_frog: '🐸', caterpillar: '🐛', triceratops: '🦖',
      pig: '🐖', praying_mantis: '🦗', snail: '🐌',
      // Added new pets from eggData's hatchablePets
      black_bunny: '🐰', chicken: '🐔', deer: '🦌', silver_monkey: '🐒',
      sea_otter: '🦦', turtle: '🐢', polar_bear: '🐻‍❄️', grey_mouse: '🐭',
      brown_mouse: '🐁', squirrel: '🐿️', red_giant_ant: '🐜', red_fox: '🦊',
      bee: '🐝', honey_bee: '🍯🐝', bear_bee: '🐻🐝', petal_bee: '🌸🐝',
      queen_bee: '👑🐝', ostrich: '🦩', peacock: '🦚', capybara: '🐹',
      macaw: '🦜', mimic_octopus: '🐙',
    };
    return petEmojis[name] || '🐾';
  }
  return '❓'; // Default for unknown item types
};

// Helper to capitalize first letter of each word and replace underscores
const formatNameForDisplay = (name) => {
  return name.split('_')
             .map(word => word.charAt(0).toUpperCase() + word.slice(1))
             .join(' ');
};

// Helper to get role color based on item type and rarity/name
const getRoleColor = (type, name) => {
  if (type === 'plant') {
    const rarity = plants[name]?.rarity;
    switch (rarity) {
      case 'Common': return '#00FF00'; // Green
      case 'Uncommon': return '#0000FF'; // Blue
      case 'Rare': return '#800080'; // Purple
      case 'Legendary': return '#FFD700'; // Gold
      case 'Mythical': return '#00FFFF'; // Cyan
      case 'Divine': return '#FFA500'; // Orange
      case 'Prismatic': return '#FF69B4'; // Pink
      default: return '#FFFFFF'; // White
    }
  } else if (type === 'egg') {
    return '#FFD700'; // Gold for all eggs
  } else if (type === 'weather') {
    return weatherData[name]?.color || '#FFFFFF'; // Use defined weather color
  }
  return '#FFFFFF'; // Default white
};

// Helper to get role emoji
const getRoleEmoji = (type, name) => {
  if (type === 'plant') {
    return getEmoji('seed', name, 0); // Use seed emoji for plant roles
  } else if (type === 'egg') {
    return getEmoji('pet_egg', name); // Use egg emoji for egg roles
  } else if (type === 'weather') {
    return weatherData[name]?.emoji || '❓';
  }
  return '❓';
};

// Helper to get role name
const getRoleName = (type, name) => {
  if (type === 'plant') {
    // Plant roles should NOT have "DVMS" prefix
    return `${formatNameForDisplay(name)}`;
  } else if (type === 'egg') {
    // Egg roles should have "DVMS" prefix
    return `DVMS ${formatNameForDisplay(name)}`;
  } else if (type === 'weather') {
    // Weather roles should use their specific roleName defined in weatherData
    return weatherData[name]?.roleName || `DVMS ${formatNameForDisplay(name)} Weather`;
  }
  return `DVMS ${formatNameForDisplay(name)}`;
};


const applyMutations = (plant, gardenSlot, user, currentWeather) => {
  let currentMutations = gardenSlot.mutations || []; // Use let for reassigning
  const pets = user.pets || [];

  // Weather-based mutations
  if (currentWeather) {
    const weather = weatherData[currentWeather];
    if (weather.growthBoost) {
      // Apply growth boost logic in cron
    }
    if (weather.mutations) {
      for (const [mutation, chance] of Object.entries(weather.mutations)) {
        if (Math.random() < chance) {
          if (mutation === 'moonlit' && gardenSlot.moonlitCount >= weather.limit) continue;
          if (mutation === 'bloodlit' && gardenSlot.bloodlitCount >= weather.limit) continue;
          // Ensure mutation object is correctly formed
          currentMutations.push({ name: mutation, ...mutations[mutation] });
          if (mutation === 'moonlit') gardenSlot.moonlitCount = (gardenSlot.moonlitCount || 0) + 1;
          if (mutation === 'bloodlit') gardenSlot.bloodlitCount = (gardenSlot.bloodlitCount || 0) + 1;
        }
      }
    }
    if (weather.condition === 'night|blood_moon' && ['night', 'blood_moon'].includes(currentWeather) && Math.random() < 0.05) {
      currentMutations.push({ name: 'celestial', ...mutations.celestial });
    }
  }

  // Combination rules
  if (currentMutations.some(m => m.name === 'wet') && currentMutations.some(m => m.name === 'sandy')) {
    currentMutations = currentMutations.filter(m => !['wet', 'sandy'].includes(m.name));
    currentMutations.push({ name: 'clay', ...mutations.clay });
  }
  if (currentMutations.some(m => m.name === 'wet' || m.name === 'drenched') && currentMutations.some(m => m.name === 'chilled')) {
    currentMutations = currentMutations.filter(m => !['wet', 'drenched', 'chilled'].includes(m.name));
    currentMutations.push({ name: 'frozen', ...mutations.frozen });
  }
  if (currentMutations.some(m => m.name === 'drenched')) currentMutations = currentMutations.filter(m => m.name !== 'wet');

  // Pet-based mutations
  if (pets.includes('dragonfly') && Math.random() < 0.1) currentMutations.push({ name: 'gold', ...mutations.gold });
  if (pets.includes('butterfly') && gardenSlot.mutations.length >= 5 && Math.random() < 0.05) {
    currentMutations.length = 0; // Clear existing mutations for rainbow
    currentMutations.push({ name: 'rainbow', ...mutations.rainbow });
  }
  if (pets.includes('polar_bear') && Math.random() < 0.1) currentMutations.push({ name: 'chilled', ...mutations.chilled });
  if (pets.includes('sea_turtle') && Math.random() < 0.1) currentMutations.push({ name: 'wet', ...mutations.wet });
  if (pets.includes('pterodactyl') && Math.random() < 0.1) currentMutations.push({ name: 'twisted', ...mutations.twisted });

  return currentMutations;
};

// Helper to get current weather from Supabase
async function updateWeather() {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let { data: weather, error } = await supabase
    .from('weather')
    .select('*')
    .order('start_time', { ascending: false })
    .limit(1)
    .single();

  if (error || !weather) {
    console.log("Weather data not found or error fetching, initializing...");
    const { data: newWeatherData, error: insertError } = await supabase.from('weather').insert({
      type: 'clear',
      start_time: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      duration: 3600
    }).select('*').single();

    if (insertError) {
      console.error("Error inserting default weather:", insertError);
      return 'clear';
    }
    weather = newWeatherData;
  }

  if ((Date.now() - new Date(weather.start_time).getTime()) / 1000 >= weather.duration) {
    let newWeatherType = 'clear';
    let newDuration = 3600;

    const scheduled = weatherData.night.schedule.some(t => Math.abs(utcMinutes - t) < 5);
    if (scheduled) {
      const isBloodMoon = Math.random() < weatherData.blood_moon.chance;
      newWeatherType = isBloodMoon ? 'blood_moon' : 'night';
      newDuration = weatherData[newWeatherType].duration;
    } else {
      const nextWeatherCandidate = Object.keys(weatherData).find(w =>
        w !== 'night' && w !== 'blood_moon' &&
        (!weatherData[w].next || (Date.now() - new Date(weather.start_time).getTime()) / 1000 >= weatherData[w].next)
      );

      if (nextWeatherCandidate) {
        if (weatherData[nextWeatherCandidate].replaces && weather.type === weatherData[nextWeatherCandidate].replaces && Math.random() < weatherData[nextWeatherCandidate].chance) {
          newWeatherType = nextWeatherCandidate;
          newDuration = weatherData[newWeatherType].duration;
        } else if (!weatherData[nextWeatherCandidate].condition || (weatherData[nextWeatherCandidate].condition === 'rare' && Math.random() < 0.01)) {
          newWeatherType = nextWeatherCandidate;
          newDuration = weatherData[newWeatherType].duration;
        }
      }
    }

    if (weather.type !== newWeatherType || weather.duration !== newDuration) {
      const { error: updateError } = await supabase.from('weather').upsert({
        type: newWeatherType,
        start_time: now.toISOString(),
        duration: newDuration
      });
      if (updateError) {
        console.error("Error updating weather:", updateError);
      } else {
        const { data: roleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', `weather_${newWeatherType}`).single();
        if (roleMap?.role_id) {
          await sendNotification('weather', newWeatherType, roleMap.role_id);
        }
      }
      return newWeatherType;
    }
  }
  return weather.type;
}


// Initialize user data
async function initUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') { // PGRST116 means no rows found
    await supabase.from('users').insert({
      user_id: userId,
      balance: 1000,
      inventory: [],
      garden: Array(9).fill(null),
      pets: [],
      last_daily: null,
      last_growth_calculation_time: null, // Initialize new field
      active_garden_until: null, // New field: Initialize to null
    });
  } else if (error) {
    console.error("Error fetching user in initUser:", error);
  }
}

// Map to store active countdown timers for shop messages
const shopTimers = new Map();

// Global map to store active garden message and their associated Supabase channel subscriptions
// Now stores { message: Discord.Message, channel: RealtimeChannel, timeout: NodeJS.Timeout, channelId: string }
const userGardenSubscriptions = new Map();


// Helper to check inventory capacity
async function checkInventoryCapacity(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('inventory')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error("Error checking inventory capacity:", error);
    return false; // Assume full or error if data cannot be retrieved
  }
  return user.inventory.length < MAX_INVENTORY_SIZE;
}

// Function to send notifications to the tracking channel
async function sendNotification(roleType, itemName, roleId) {
  try {
    const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
    if (!notificationChannel) {
      console.error(`Notification channel with ID ${NOTIFICATION_CHANNEL_ID} not found.`);
      return;
    }

    const roleMention = roleId ? `<@&${roleId}>` : '';
    let messageContent = '';

    if (roleType === 'plant') {
      messageContent = `${roleMention} **New Plant in Shop!** ${formatNameForDisplay(itemName)} is now available!`;
    } else if (roleType === 'egg') {
      messageContent = `${roleMention} **New Pet Egg in Shop!** ${formatNameForDisplay(itemName)} is now available!`;
    } else if (roleType === 'weather') {
      messageContent = `${roleMention} **Weather Update!** The weather has changed to ${formatNameForDisplay(itemName)}!`;
    }

    await notificationChannel.send(messageContent);
  } catch (error) {
    console.error(`Error sending notification for ${roleType} ${itemName}:`, error);
  }
}


// Update weather cron job (now calls the moved updateWeather function)
cron.schedule('*/1 * * * *', async () => {
  const currentWeather = await updateWeather(); // Fetch current weather once
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*');

  if (usersError) {
    console.error("Error fetching users for cron job:", usersError);
    return;
  }

  if (!users || users.length === 0) {
    console.log("No users found, skipping plant growth update.");
    return;
  }

  for (const user of users) {
    // Always update totalGrowthTimeAccumulated for all users with planted gardens
    // This ensures offline growth
    let updated = false;
    let garden = user.garden;
    const now = Date.now();
    const lastCalcTime = user.last_growth_calculation_time ? new Date(user.last_growth_calculation_time).getTime() : now;
    const timeSinceLastCalc = now - lastCalcTime;

    // Determine if the garden is currently active for mutations/weather traits
    const isActiveForMutations = user.active_garden_until && (now < new Date(user.active_garden_until).getTime());

    for (let i = 0; i < garden.length; i++) {
      if (garden[i] && garden[i].plantedAt) {
        // Ensure totalGrowthTimeAccumulated exists
        garden[i].totalGrowthTimeAccumulated = (garden[i].totalGrowthTimeAccumulated || 0) + timeSinceLastCalc; // Always accumulate growth

        const plantData = plants[garden[i].name];
        const baseGrowthTime = plantData.growthTime / 4;
        let adjustedGrowthTime = baseGrowthTime;
        // Apply growth boost only if active for mutations
        if (isActiveForMutations && currentWeather && weatherData[currentWeather]?.growthBoost) {
          adjustedGrowthTime /= (1 + weatherData[currentWeather].growthBoost);
        }

        const level = Math.min(
          4,
          Math.floor(garden[i].totalGrowthTimeAccumulated / (adjustedGrowthTime * 1000)) // Convert adjustedGrowthTime to ms
        );

        if (garden[i].level !== level) {
          garden[i].level = level;
          updated = true;
        }

        // Apply mutations ONLY if the garden is currently active for mutations
        if (isActiveForMutations) {
          const oldMutationsLength = garden[i].mutations ? garden[i].mutations.length : 0;
          garden[i].mutations = applyMutations(garden[i].name, garden[i], user, currentWeather);
          if (garden[i].mutations.length !== oldMutationsLength || (oldMutationsLength > 0 && JSON.stringify(garden[i].mutations) !== JSON.stringify(user.garden[i].mutations))) {
              updated = true; // Mark as updated if mutations changed
          }
        }
        
        const seed = `${user.user_id}_${i}_${garden[i].plantedAt}`;
        [garden[i].weight] = calculateWeight(seed, garden[i].name);
        updated = true; // Weight calculation might change even if level doesn't
      }
    }
    if (updated) {
      await supabase
        .from('users')
        .update({ garden, last_growth_calculation_time: now }) // Always update last calc time for continuous growth tracking
        .eq('user_id', user.user_id);
    }
  }
});

// Update shop stock every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const { data: oldShop } = await supabase
    .from('shop')
    .select('stock')
    .eq('id', 'global')
    .single();
  const oldStock = oldShop?.stock || {};

  const newStock = getRandomPlants(oldStock);
  await supabase
    .from('shop')
    .upsert({ id: 'global', stock: newStock, last_restock: new Date().toISOString() });
  console.log('Shop stock updated:', newStock);

  // Send notifications for ALL currently stocked plants
  for (const plantName in newStock) {
    if (newStock[plantName] > 0) { // Check if quantity is greater than 0
      const { data: roleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', `plant_${plantName}`).single();
      if (roleMap?.role_id) {
        await sendNotification('plant', plantName, roleMap.role_id);
      }
    }
  }
});

// Update pet egg shop stock every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  const { data: oldPetShop, error: petShopError } = await supabase
    .from('pet_eggs_shop')
    .select('*')
    .eq('id', 'global')
    .single();

  const oldPetStock = oldPetShop?.stock || {};
  let newPetStock = {};
  let updated = false;

  const availableEggsInShop = Object.keys(eggData).filter(type => eggData[type].eggsShop);

  // First, probabilistically add eggs based on their shopChance
  for (const eggType of availableEggsInShop) {
    if (Math.random() < eggData[eggType].shopChance) {
      newPetStock[eggType] = 1;
    }
  }

  const currentEggCount = Object.keys(newPetStock).length;

  // Ensure there are at least 3 eggs, filling with random ones if needed
  if (currentEggCount < 3) {
    const eggsToFill = 3 - currentEggCount;
    const shuffledAvailableEggs = availableEggsInShop.sort(() => 0.5 - Math.random()); // Shuffle for random picking
    let filledCount = 0;
    for (const eggType of shuffledAvailableEggs) {
      if (filledCount >= eggsToFill) break;
      if (!newPetStock.hasOwnProperty(eggType)) {
        newPetStock[eggType] = 1;
      }
    }
  }

  // If there are more than 3 eggs, randomly remove until there are 3
  if (Object.keys(newPetStock).length > 3) {
    let eggsToRemove = Object.keys(newPetStock).length - 3;
    const eggsInStockArray = Object.keys(newPetStock);
    // Shuffle the array to randomly select eggs to remove
    eggsInStockArray.sort(() => 0.5 - Math.random());
    for (let i = 0; i < eggsToRemove; i++) {
      delete newPetStock[eggsInStockArray[i]];
    }
  }

  // Check if stock actually changed to avoid unnecessary DB writes and notifications
  const oldStockKeys = Object.keys(oldPetStock).sort().join(',');
  const newStockKeys = Object.keys(newPetStock).sort().join(',');

  if (oldStockKeys !== newStockKeys) {
    updated = true;
  }

  if (updated || !oldPetShop) {
    await supabase
      .from('pet_eggs_shop')
      .upsert({ id: 'global', stock: newPetStock, last_restock: new Date().toISOString() });
    console.log('Pet egg shop stock updated:', newPetStock);

    // Send notifications for newly stocked pet eggs
    for (const eggType in newPetStock) {
      if (newPetStock[eggType] > 0 && (!oldPetStock[eggType] || oldPetStock[eggType] === 0)) {
        const { data: roleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', `egg_${eggType}`).single();
        if (roleMap?.role_id) {
          await sendNotification('egg', eggType, roleMap.role_id);
        }
      }
    }
  }
});


// Slash commands definitions
const allCommands = [
  // Player Commands
  { name: 'daily', description: 'Claim daily rewards', group: 'player' },
  { name: 'garden', description: 'View your garden', group: 'player' },
  { name: 'plant', description: 'Plant a seed', group: 'player' },
  { name: 'harvest', description: 'Harvest a plant', group: 'player' },
  { name: 'sell', description: 'Sell harvested plants or pets', group: 'player' },
  { name: 'shop', description: 'View and buy seeds from Sam\'s Shop', group: 'player' },
  { name: 'inventory', description: 'View your inventory and balance', group: 'player' },
  { name: 'leaderboard', description: 'View top gardeners', group: 'player' },
  { name: 'weather', description: 'View current weather', group: 'player' },
  { name: 'info', description: 'Get info about a garden slot', group: 'player' },
  { name: 'favourite', description: 'Favourite a harvested plant or pet to prevent selling', group: 'player' },
  { name: 'unfavourite', description: 'Unfavourite a harvested plant or pet to allow selling', group: 'player' },
  { name: 'petshop', description: 'View and buy pet eggs', group: 'player' },
  { name: 'hatch', description: 'Hatch a pet egg from your inventory', group: 'player' },
  { name: 'shovel', description: 'Remove a plant from a garden slot (1-9)', group: 'player' },
  { name: 'tracker', description: 'Manage your notification tracking preferences', group: 'player' },
  // Admin Commands
  { name: 'initroles', description: 'Initialize Discord roles for plants, eggs, and weather (Admin Only)', group: 'admin', permissions: PermissionsBitField.Flags.ManageRoles },
  { name: 'resetstock', description: 'Reset shop stock (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'addbalance', description: 'Add balance to a user (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'clearinventory', description: 'Clear a user\'s inventory (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'globalswarm', description: 'Trigger a global bee swarm (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'globalbloodmoon', description: 'Trigger a global blood moon (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'givepet', description: 'Give a pet to a user (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'giveseed', description: 'Give a seed to a user (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'setweather', description: 'Manually set the global weather (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'gift', description: 'Gift an item from your inventory to another user (Admin Only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
  { name: 'seedadd', description: 'Add a specific seed to Sam\'s shop (admin only)', group: 'admin', permissions: PermissionsBitField.Flags.Administrator },
];

const commandsToRegister = allCommands.map(cmd => {
  const slashCommand = new SlashCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description);

  // Add options specific to each command
  if (cmd.name === 'plant' || cmd.name === 'harvest' || cmd.name === 'info' || cmd.name === 'shovel') {
    slashCommand.addIntegerOption((option) =>
      option
        .setName('slot')
        .setDescription('Garden slot (1-9)')
        .setRequired(true)
    );
    if (cmd.name === 'plant') {
      slashCommand.addStringOption((option) =>
        option
          .setName('seed')
          .setDescription('Seed to plant')
          .setRequired(true)
      );
    }
  } else if (cmd.name === 'sell') {
    slashCommand.addStringOption((option) =>
      option
        .setName('target')
        .setDescription('Use "all", "max", "last", or a specific special code')
        .setRequired(true)
    );
  } else if (cmd.name === 'inventory') {
    slashCommand.addIntegerOption((option) =>
      option
        .setName('page')
        .setDescription('The inventory page number to view')
        .setRequired(false)
    );
  } else if (cmd.name === 'favourite' || cmd.name === 'unfavourite') {
    slashCommand.addStringOption((option) =>
      option
        .setName('special_code')
        .setDescription('The unique code of the item')
        .setRequired(true)
    );
  } else if (cmd.name === 'hatch') {
    slashCommand.addIntegerOption((option) =>
      option
        .setName('inventory_index')
        .setDescription('The number of the egg in your inventory (from /inventory)')
        .setRequired(true)
    );
  } else if (cmd.name === 'addbalance' || cmd.name === 'clearinventory' || cmd.name === 'givepet' || cmd.name === 'giveseed' || cmd.name === 'gift') {
    slashCommand.addUserOption((option) =>
      option
        .setName('user')
        .setDescription('User to target')
        .setRequired(true)
    );
    if (cmd.name === 'addbalance') {
      slashCommand.addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription('Amount to add')
          .setRequired(true)
      );
    } else if (cmd.name === 'givepet') {
      slashCommand.addStringOption(option =>
        option.setName('pet_name')
          .setDescription('The name of the pet to give (e.g., "dog", "cat")')
          .setRequired(true));
    } else if (cmd.name === 'giveseed') {
      slashCommand.addStringOption(option =>
        option.setName('seed_name')
          .setDescription('The name of the seed to give (e.g., "carrot", "pumpkin")')
          .setRequired(true))
        .addIntegerOption(option =>
          option.setName('quantity')
            .setDescription('The quantity of seeds to give (default: 1)')
            .setRequired(false));
    } else if (cmd.name === 'gift') {
      slashCommand.addStringOption(option =>
        option.setName('special_code')
          .setDescription('The special code of the item to gift from your inventory')
          .setRequired(true));
    }
  } else if (cmd.name === 'setweather') {
    slashCommand.addStringOption(option =>
      option.setName('weather_type')
        .setDescription('The type of weather to set')
        .setRequired(true)
        .addChoices(
          { name: 'Clear', value: 'clear' },
          { name: 'Rain', value: 'rain' },
          { name: 'Thunderstorm', value: 'thunderstorm' },
          { name: 'Night', value: 'night' },
          { name: 'Blood Moon', value: 'blood_moon' },
          { name: 'Meteor Shower', value: 'meteor_shower' },
          { name: 'Windy', value: 'windy' },
          { name: 'Gale', value: 'gale' },
          { name: 'Tornado', value: 'tornado' },
          { name: 'Sandstorm', value: 'sandstorm' },
          { name: 'Heat Wave', value: 'heat_wave' },
          { name: 'Tropical Rain', value: 'tropical_rain' },
          { name: 'Bee Swarm', value: 'bee_swarm' },
          { name: 'Worker Bee Swarm', value: 'worker_bee_swarm' }
        ));
  } else if (cmd.name === 'seedadd') {
    slashCommand.addStringOption(option =>
      option.setName('seed_name')
        .setDescription('The name of the seed to add to the shop')
        .setRequired(true))
      .addIntegerOption(option =>
        option.setName('quantity')
          .setDescription('The quantity of seeds to add')
          .setRequired(true));
  }

  // Set default permissions
  if (cmd.permissions) {
    slashCommand.setDefaultMemberPermissions(cmd.permissions);
  } else {
    // For all non-admin commands, set default permissions to 0 (no one can use by default)
    // This requires server admins to explicitly grant "Use Application Commands" to specific roles.
    slashCommand.setDefaultMemberPermissions(0);
  }

  return slashCommand.toJSON();
});


// Register commands
client.once('ready', async () => {
  console.log('Bot is ready!');
  await client.application.commands.set(commandsToRegister);
});

// Function to generate the garden display content and components
async function getGardenDisplayContent(user, currentWeather) {
    let display = `🌳 **Your DVMS Garden** 🌳 (Weather: ${currentWeather || 'Clear'})\n`;
    for (let i = 0; i < 9; i++) {
        const slot = user.garden[i];
        display += slot
            ? `${getEmoji(slot.type, slot.name, slot.level, slot.mutations)} [${formatNameForDisplay(slot.name)} - Lvl ${slot.level === 4 ? 'Max' : slot.level}]`
            : '⬛ [Empty]';
        display += '\n'; // Each slot on its own row
    }

    // Simplified disclaimer as per user request
    display += `\n*Your garden will only get weather traits for 5 minutes until you /garden again.*`;

    const rows = [];
    const row1 = new ActionRowBuilder();
    row1.addComponents(
        new ButtonBuilder().setCustomId(`info_1`).setLabel('1').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_2`).setLabel('2').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_3`).setLabel('3').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_4`).setLabel('4').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_5`).setLabel('5').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder();
    row2.addComponents(
        new ButtonBuilder().setCustomId(`info_6`).setLabel('6').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_7`).setLabel('7').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_8`).setLabel('8').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info_9`).setLabel('9').setStyle(ButtonStyle.Secondary)
    );
    rows.push(row1, row2);

    // Add a refresh button
    const refreshRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('refresh_garden')
            .setLabel('Refresh Garden')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄')
    );
    rows.push(refreshRow);

    return { content: display, components: rows };
}

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const isAdminCommand = allCommands.find(cmd => cmd.name === interaction.commandName && cmd.group === 'admin');

    // Defer reply, making it ephemeral if it's an admin command, otherwise public
    await interaction.deferReply({ ephemeral: isAdminCommand });

    await initUser(interaction.user.id);
    const { data: user, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', interaction.user.id)
      .single();

    if (userFetchError || !user) {
      console.error(`Failed to fetch user ${interaction.user.id}:`, userFetchError);
      await interaction.editReply({ content: 'There was an error fetching your data. Please try again later.', ephemeral: true });
      return;
    }

    const currentWeather = await updateWeather();

    const command = interaction.commandName;

    if (command === 'daily') {
      if (!(await checkInventoryCapacity(interaction.user.id))) {
        await interaction.editReply('Your inventory is full! Max 200 items.');
        return;
      }
      const newSeedName = Object.keys(plants)[Math.floor(Math.random() * Object.keys(plants).length)];
      // Store daily seed as an object with type 'seed', no specialCode
      const newInventory = [...user.inventory, { 
          name: newSeedName, 
          mutations: [], 
          weight: plants[newSeedName].baseWeight,
          type: 'seed'
      }];
      await supabase
        .from('users')
        .update({
          balance: user.balance + 250,
          inventory: newInventory,
          last_daily: new Date().toISOString(),
        })
        .eq('user_id', interaction.user.id);
      await interaction.editReply(
        `You claimed 250 Sheckles and a ${formatNameForDisplay(newSeedName)} seed! 🌱`
      );
    } else if (command === 'garden') {
      // If there's an existing live garden view for this user in this channel, unsubscribe and clear timeout
      const existingSubscription = userGardenSubscriptions.get(interaction.user.id);
      if (existingSubscription && existingSubscription.channelId === interaction.channel.id) {
          existingSubscription.channel.unsubscribe();
          clearTimeout(existingSubscription.timeout);
          userGardenSubscriptions.delete(interaction.user.id);
      }

      // Update last_growth_calculation_time and active_garden_until
      const now = Date.now();
      const newActiveUntil = new Date(now + 5 * 60 * 1000).toISOString(); // 5 minutes from now

      // Fetch the latest user data to apply updates correctly before display
      const { data: latestUserBeforeDisplay, error: latestUserBeforeDisplayError } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', interaction.user.id)
          .single();

      if (latestUserBeforeDisplayError || !latestUserBeforeDisplay) {
          console.error(`Failed to fetch latest user data for /garden:`, latestUserBeforeDisplayError);
          await interaction.editReply({ content: 'There was an error fetching your data. Please try again later.' });
          return;
      }

      let updatedGarden = [...latestUserBeforeDisplay.garden];
      let gardenUpdatedForUser = false;
      const lastCalcTime = latestUserBeforeDisplay.last_growth_calculation_time ? new Date(latestUserBeforeDisplay.last_growth_calculation_time).getTime() : now;
      const timeSinceLastCalc = now - lastCalcTime;

      // Determine if the garden is currently active for mutations/weather traits
      const isActiveForMutations = new Date(newActiveUntil).getTime() > now; // Check against the *new* active until time

      for (let i = 0; i < updatedGarden.length; i++) {
          if (updatedGarden[i] && updatedGarden[i].plantedAt) {
              updatedGarden[i].totalGrowthTimeAccumulated = (updatedGarden[i].totalGrowthTimeAccumulated || 0) + timeSinceLastCalc;

              const plantData = plants[updatedGarden[i].name];
              const baseGrowthTime = plantData.growthTime / 4;
              let adjustedGrowthTime = baseGrowthTime;
              // Apply growth boost only if garden is active
              if (isActiveForMutations && currentWeather && weatherData[currentWeather]?.growthBoost) {
                  adjustedGrowthTime /= (1 + weatherData[currentWeather].growthBoost);
              }

              const level = Math.min(
                  4,
                  Math.floor(updatedGarden[i].totalGrowthTimeAccumulated / (adjustedGrowthTime * 1000))
              );

              if (updatedGarden[i].level !== level) {
                  updatedGarden[i].level = level;
                  gardenUpdatedForUser = true;
              }
              // Apply mutations immediately if garden is activated/reactivated
              // This is done here to ensure the initial display is accurate
              // Only apply mutations if the garden is active
              if (isActiveForMutations) {
                updatedGarden[i].mutations = applyMutations(updatedGarden[i].name, updatedGarden[i], latestUserBeforeDisplay, currentWeather);
              } else {
                // If not active, clear mutations or keep previous ones without new application
                // For simplicity, let's just not apply new ones if inactive
                updatedGarden[i].mutations = updatedGarden[i].mutations || [];
              }
              
              const seed = `${latestUserBeforeDisplay.user_id}_${i}_${updatedGarden[i].plantedAt}`;
              [updatedGarden[i].weight] = calculateWeight(seed, updatedGarden[i].name);
              gardenUpdatedForUser = true; // Mark as updated for weight/mutations
          }
      }

      await supabase
          .from('users')
          .update({ 
              garden: updatedGarden, 
              last_growth_calculation_time: now, // Update last calc time
              active_garden_until: newActiveUntil // Set active window
          })
          .eq('user_id', interaction.user.id);

      // Get updated user data after potential garden update (to ensure latest active_garden_until is fetched)
      const { data: latestUserForDisplay, error: latestUserForDisplayError } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', interaction.user.id)
          .single();

      if (latestUserForDisplayError || !latestUserForDisplay) {
          console.error(`Failed to fetch latest user data for garden display:`, latestUserForDisplayError);
          await interaction.editReply({ content: 'There was an error displaying your garden. Please try again later.' });
          return;
      }

      const { content, components } = await getGardenDisplayContent(latestUserForDisplay, currentWeather);
      const message = await interaction.editReply({ content, components }); // Send to the interaction channel

      // Set up Supabase real-time subscription for this user's garden
      const channelName = `garden_updates_${interaction.user.id}`;
      const gardenChannel = supabase.channel(channelName);

      gardenChannel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'users', filter: `user_id=eq.${interaction.user.id}` },
          async (payload) => {
              if (payload.new && payload.new.garden) {
                  const updatedWeather = await updateWeather(); // Re-fetch weather for display
                  const { data: latestUserOnUpdate, error: latestUserErrorOnUpdate } = await supabase
                    .from('users')
                    .select('*')
                    .eq('user_id', interaction.user.id)
                    .single();

                  if (latestUserErrorOnUpdate || !latestUserOnUpdate) {
                    console.error("Error fetching latest user data for garden update:", latestUserErrorOnUpdate);
                    return;
                  }
                  // Only update the message if the garden is still active
                  const nowOnUpdate = Date.now();
                  const activeUntilOnUpdate = latestUserOnUpdate.active_garden_until ? new Date(latestUserOnUpdate.active_garden_until).getTime() : 0;
                  if (nowOnUpdate < activeUntilOnUpdate) {
                    const { content: updatedDisplay, components: rowsToResend } = await getGardenDisplayContent(latestUserOnUpdate, updatedWeather);
                    try {
                        await message.edit({ content: updatedDisplay, components: rowsToResend });
                    } catch (editError) {
                        console.error("Error editing Discord message:", editError);
                        gardenChannel.unsubscribe();
                        clearTimeout(userGardenSubscriptions.get(interaction.user.id)?.timeout);
                        userGardenSubscriptions.delete(interaction.user.id);
                    }
                  } else {
                    // If garden becomes inactive during a real-time update, unsubscribe and update message
                    gardenChannel.unsubscribe();
                    clearTimeout(userGardenSubscriptions.get(interaction.user.id)?.timeout);
                    userGardenSubscriptions.delete(interaction.user.id);
                    const { content: finalDisplay, components: finalComponents } = await getGardenDisplayContent(latestUserOnUpdate, updatedWeather);
                    await message.edit({ content: finalDisplay, components: finalComponents }).catch(e => {});
                  }
              }
          }
      ).subscribe();

      // Set timeout for deactivating the garden view
      const timeout = setTimeout(() => {
          gardenChannel.unsubscribe();
          userGardenSubscriptions.delete(interaction.user.id);
          console.log(`Unsubscribed from garden updates for user ${interaction.user.id} (timeout).`);
          try {
               // Re-fetch user data to get the latest state before marking inactive
               supabase.from('users').select('*').eq('user_id', interaction.user.id).single().then(async ({data: finalUser}) => {
                   if (finalUser) {
                       const finalWeather = await updateWeather();
                       const { content: finalDisplay, components: finalComponents } = await getGardenDisplayContent(finalUser, finalWeather);
                       await message.edit({ content: finalDisplay, components: finalComponents }).catch(e => {}); // Update with inactive message
                   }
               }).catch(e => console.error("Error fetching user for final garden message update:", e));
          } catch (e) {}
      }, 5 * 60 * 1000); // 5 minutes

      userGardenSubscriptions.set(interaction.user.id, { message, channel: gardenChannel, timeout, channelId: interaction.channel.id });

    } else if (command === 'plant') {
      const slot = interaction.options.getInteger('slot') - 1;
      const seedName = interaction.options.getString('seed').toLowerCase();
      if (slot < 0 || slot > 8) {
        await interaction.editReply('Invalid slot! Choose 1-9.');
        return;
      }
      if (!plants[seedName]) {
        await interaction.editReply('Invalid seed!');
        return;
      }
      
      // Find the seed in inventory, ensuring it's a seed and not a harvested plant or pet egg
      let seedIndex = user.inventory.findIndex(item => 
        (item.type === 'seed' && item.name === seedName) ||
        (typeof item === 'string' && item === seedName)
      );

      if (seedIndex === -1) {
        await interaction.editReply(`You don't have a ${formatNameForDisplay(seedName)} seed!`);
        return;
      }
      if (user.garden[slot]) {
        await interaction.editReply('That slot is already occupied!');
        return;
      }
      const newGarden = [...user.garden];
      const seedKey = `${user.user_id}_${slot}_${Date.now()}`;
      const [weight] = calculateWeight(seedKey, seedName);
      newGarden[slot] = { 
        name: seedName, 
        level: 0, 
        plantedAt: Date.now(), 
        mutations: [], 
        moonlitCount: 0, 
        bloodlitCount: 0, 
        weight, 
        type: 'plant',
        totalGrowthTimeAccumulated: 0 // Initialize new field
      };
      
      const newInventory = [...user.inventory];
      newInventory.splice(seedIndex, 1);

      await supabase
        .from('users')
        .update({ garden: newGarden, inventory: newInventory })
        .eq('user_id', interaction.user.id);
      await interaction.editReply(`Planted ${formatNameForDisplay(seedName)} in slot ${slot + 1} with weight ${weight.toFixed(2)}kg! 🌱`);
    } else if (command === 'harvest') {
      const slot = interaction.options.getInteger('slot') - 1;
      if (slot < 0 || slot > 8 || !user.garden[slot]) {
        await interaction.editReply('Invalid or empty slot!');
        return;
      }
      const plant = user.garden[slot];
      const plantData = plants[plant.name]; // Get plant data for multiHarvest check

      if (plant.level < 4) {
        await interaction.editReply('This plant is not fully grown yet! It needs to reach Level Max.');
        return;
      }
      
      if (!(await checkInventoryCapacity(interaction.user.id))) {
        await interaction.editReply('Your inventory is full! Max 200 items. Sell some items before harvesting.');
        return;
      }

      const specialCode = generateSpecialCode();
      const newGarden = [...user.garden];
      const newInventory = [...user.inventory];

      // Add harvested plant to inventory
      newInventory.push({ 
          name: plant.name, 
          mutations: plant.mutations, 
          weight: plant.weight, 
          specialCode: specialCode,
          type: 'harvested_plant',
          favourite: false
      });

      // Handle multi-harvest logic
      if (plantData.multiHarvest) {
        // Reset plant to level 1, keep existing mutations and type
        const seedKey = `${user.user_id}_${slot}_${Date.now()}`; // New seed for new growth cycle
        const [newWeight] = calculateWeight(seedKey, plant.name);
        newGarden[slot] = { 
          name: plant.name, 
          level: 1, // Reset to level 1 for multi-harvest
          plantedAt: Date.now(), 
          mutations: plant.mutations, // Keep existing mutations
          moonlitCount: plant.moonlitCount, // Keep mutation counts
          bloodlitCount: plant.bloodlitCount, // Keep mutation counts
          weight: newWeight, // New weight for the reset plant
          type: 'plant', // Keep type as plant
          totalGrowthTimeAccumulated: plant.totalGrowthTimeAccumulated // Keep accumulated growth
        };
      } else {
        // Single harvest: remove plant from garden
        newGarden[slot] = null;
      }

      await supabase
        .from('users')
        .update({ garden: newGarden, inventory: newInventory })
        .eq('user_id', interaction.user.id);
      
      const mutationsDisplay = plant.mutations.length ? ` with mutations ${plant.mutations.map(m => formatNameForDisplay(m.name)).join(', ')}` : '';
      await interaction.editReply(`Harvested ${formatNameForDisplay(plant.name)}${mutationsDisplay}! Weight: ${plant.weight.toFixed(2)}kg. Added to inventory with code: [${specialCode}]`);
    } else if (command === 'sell') {
      const target = interaction.options.getString('target').toLowerCase();
      let itemsToSell = [];
      let totalEarnings = 0;
      let replyMessage = '';

      if (target === 'all' || target === 'max') {
        itemsToSell = user.inventory.filter(item => 
          item.type === 'harvested_plant' && !item.favourite
        );
        if (itemsToSell.length === 0) {
          await interaction.editReply('You have no non-favourited harvested plants to sell.');
          return;
        }
        for (const item of itemsToSell) {
          totalEarnings += getSellPrice(item.name, 4, item.mutations, item.weight);
        }
        replyMessage = `Sold ${itemsToSell.length} harvested plants for a total of ${totalEarnings.toFixed(2)} Sheckles!`; // Format earnings
      } else if (target === 'last') {
        // Find the most recently harvested non-favourited plant
        let lastHarvestedIndex = -1;
        for (let i = user.inventory.length - 1; i >= 0; i--) {
            const item = user.inventory[i];
            if (item.type === 'harvested_plant' && !item.favourite) {
                lastHarvestedIndex = i;
                break;
            }
        }

        if (lastHarvestedIndex === -1) {
            await interaction.editReply('You have no non-favourited harvested plants to sell.');
            return;
        }

        const itemToSell = user.inventory[lastHarvestedIndex];
        itemsToSell.push(itemToSell);
        totalEarnings = getSellPrice(itemToSell.name, 4, itemToSell.mutations, itemToSell.weight);
        const mutationsDisplay = itemToSell.mutations.length ? ` with mutations ${itemToSell.mutations.map(m => formatNameForDisplay(m.name)).join(', ')}` : '';
        replyMessage = `Sold ${formatNameForDisplay(itemToSell.name)}${mutationsDisplay} (Code: [${itemToSell.specialCode}]) for ${totalEarnings.toFixed(2)} Sheckles! Weight: ${itemToSell.weight.toFixed(2)}kg.`; // Format earnings

      } else { // Assume target is a special code
        const specialCode = target;
        let itemToSell = null;
        let itemIndex = -1;

        // Find the item by special code
        for (let i = 0; i < user.inventory.length; i++) {
            if (user.inventory[i].specialCode === specialCode) {
                itemToSell = user.inventory[i];
                itemIndex = i;
                break;
            }
        }

        if (!itemToSell) {
            await interaction.editReply(`Could not find an item with code [${specialCode}] in your inventory.`);
            return;
        }

        if (itemToSell.type !== 'harvested_plant') {
            await interaction.editReply(`Only harvested plants can be sold. The item with code [${specialCode}] is a ${itemToSell.type}.`);
            return;
        }

        if (itemToSell.favourite) {
            await interaction.editReply(`You cannot sell ${formatNameForDisplay(itemToSell.name)} (Code: [${itemToSell.specialCode}]) because it is favourited. Unfavourite it first.`);
            return;
        }

        itemsToSell.push(itemToSell);
        totalEarnings = getSellPrice(itemToSell.name, 4, itemToSell.mutations, itemToSell.weight);
        const mutationsDisplay = itemToSell.mutations.length ? ` with mutations ${itemToSell.mutations.map(m => formatNameForDisplay(m.name)).join(', ')}` : '';
        replyMessage = `Sold ${formatNameForDisplay(itemToSell.name)}${mutationsDisplay} (Code: [${itemToSell.specialCode}]) for ${totalEarnings.toFixed(2)} Sheckles! Weight: ${itemToSell.weight.toFixed(2)}kg.`; // Format earnings
      }

      const newInventory = user.inventory.filter(item => 
        !itemsToSell.some(soldItem => soldItem.specialCode === item.specialCode)
      );

      await supabase
        .from('users')
        .update({ inventory: newInventory, balance: user.balance + totalEarnings })
        .eq('user_id', interaction.user.id);
      
      await interaction.editReply(replyMessage);

    } else if (command === 'shop') {
      // Re-fetch user balance for the most up-to-date display
      const { data: currentUserData } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', interaction.user.id)
        .single();
      const currentBalance = currentUserData.balance;

      let { data: shop, error: shopError } = await supabase
        .from('shop')
        .select('*')
        .eq('id', 'global')
        .single();
      
      if (shopError || !shop) {
        await supabase.from('shop').insert({
          id: 'global',
          stock: {},
          last_restock: new Date().toISOString()
        });
        ({ data: shop } = await supabase
          .from('shop')
          .select('*')
          .eq('id', 'global')
          .single());
      }

      let stock = shop.stock || {};
      if (Object.keys(stock).length === 0) {
        ['carrot', 'strawberry', 'blueberry', 'tomato', 'corn'].forEach((seed) => { // Added corn to guaranteed stock
          if (!stock[seed] || stock[seed] <= 0) {
            // Ensure plants[seed] exists before accessing its properties
            if (plants[seed]) { 
                stock[seed] = Math.min(getRandomQuantity(plants[seed].rarity), plants[seed].maxStock);
            }
          }
        });
        await supabase
          .from('shop')
          .update({ stock, last_restock: new Date().toISOString() })
          .eq('id', 'global');
      }

      const lastRestock = shop.last_restock ? new Date(shop.last_restock) : new Date();
      const restockInterval = 5 * 60 * 1000;
      const now = Date.now();
      const timeSinceLastRestock = now - lastRestock.getTime();
      const cyclesSinceLastRestock = Math.floor(timeSinceLastRestock / restockInterval);
      const nextRestockTime = lastRestock.getTime() + (cyclesSinceLastRestock + 1) * restockInterval;
      const nextRestockTimestamp = Math.floor(nextRestockTime / 1000);

      const embed = new EmbedBuilder()
        .setTitle('🌱 Sam\'s Seed Shop 🌱')
        .setColor('#00ff00')
        .addFields(
          { name: '💰 Your Balance', value: `${currentBalance} Sheckles`, inline: true },
          { name: '⏰ Next Restock', value: `<t:${nextRestockTimestamp}:R>`, inline: true }
        );

      let stockDescription = '';
      Object.entries(stock).forEach(([seed, quantity]) => {
        // Only display if quantity is positive AND the plant exists in our current plants data
        if (quantity > 0 && plants[seed]) { 
          const basePrice = plants[seed].cost;
          stockDescription += `${formatNameForDisplay(seed)} Seed (${plants[seed].rarity}) - ${basePrice} Sheckles (x${quantity})\n`;
        }
      });

      if (stockDescription) {
        embed.addFields({ name: 'Available Seeds', value: stockDescription });
      } else {
        embed.addFields({ name: 'Available Seeds', value: 'No seeds in stock!' });
      }

      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;
      let rowCount = 0; // Track number of rows for shop items

      const shopItems = Object.entries(stock).filter(([seed, quantity]) => quantity > 0 && plants[seed]);

      for (const [seed, quantity] of shopItems) {
        if (rowCount < 4) { // Limit shop item rows to 4
          if (buttonCount === 3) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
            rowCount++;
            if (rowCount >= 4) break; // Stop adding new rows if limit reached
          }
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${seed}`)
              .setLabel(`Buy ${formatNameForDisplay(seed)} Seed x${quantity}`)
              .setStyle(ButtonStyle.Primary)
              .setEmoji(getEmoji('plant', seed, 0))
              .setDisabled(quantity <= 0)
          );
          buttonCount++;
        }
      }
      if (buttonCount > 0 && rowCount < 4) rows.push(currentRow); // Push the last incomplete row if space allows

      const adminRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('restock_now')
          .setLabel('Restock Now (Admin)')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(interaction.user.id !== ADMIN_ID)
      );
      rows.push(adminRow);

      const message = await interaction.editReply({ embeds: [embed], components: rows });

      // Define updateShopCountdown function that can access `message`
      const updateShopCountdown = async () => {
        const now = Date.now();
        const timeLeft = Math.max(0, nextRestockTime - now);
        
        // Re-fetch latest shop data for accurate display
        const { data: currentShopData } = await supabase
          .from('shop')
          .select('stock, last_restock')
          .eq('id', 'global')
          .single();
        const currentStock = currentShopData?.stock || {};
        const currentLastRestock = currentShopData?.last_restock ? new Date(currentShopData.last_restock) : new Date();
        const currentNextRestockTime = currentLastRestock.getTime() + (Math.floor((now - currentLastRestock.getTime()) / restockInterval) + 1) * restockInterval;

        // Re-fetch user balance for the most up-to-date display
        const { data: currentBalanceData } = await supabase
          .from('users')
          .select('balance')
          .eq('user_id', interaction.user.id)
          .single();
        const currentDisplayBalance = currentBalanceData?.balance || 0;


        const currentEmbed = new EmbedBuilder()
          .setTitle('🌱 Sam\'s Seed Shop 🌱')
          .setColor('#00ff00')
          .addFields(
            { name: '💰 Your Balance', value: `${currentDisplayBalance} Sheckles`, inline: true },
            { name: '⏰ Next Restock', value: timeLeft <= 0 ? 'Shop has restocked!' : `<t:${Math.floor(currentNextRestockTime / 1000)}:R>`, inline: true }
          );

        let currentStockDescription = '';
        Object.entries(currentStock).forEach(([seed, quantity]) => {
          if (quantity > 0 && plants[seed]) {
            const basePrice = plants[seed].cost;
            currentStockDescription += `${formatNameForDisplay(seed)} Seed (${plants[seed].rarity}) - ${basePrice} Sheckles (x${quantity})\n`;
          }
        });
        currentEmbed.addFields({ name: 'Available Seeds', value: currentStockDescription || 'No seeds in stock!' });

        const currentRows = [];
        let currentRow = new ActionRowBuilder();
        let buttonCount = 0;
        let rowCount = 0;
        const shopItems = Object.entries(currentStock).filter(([seed, quantity]) => quantity > 0 && plants[seed]);

        for (const [seed, quantity] of shopItems) {
          if (rowCount < 4) {
            if (buttonCount === 3) {
              currentRows.push(currentRow);
              currentRow = new ActionRowBuilder();
              buttonCount = 0;
              rowCount++;
              if (rowCount >= 4) break;
            }
            currentRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`buy_${seed}`)
                .setLabel(`Buy ${formatNameForDisplay(seed)} Seed x${quantity}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(getEmoji('plant', seed, 0))
                .setDisabled(quantity <= 0)
            );
            buttonCount++;
          }
        }
        if (buttonCount > 0 && rowCount < 4) currentRows.push(currentRow);

        const adminRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('restock_now')
            .setLabel('Restock Now (Admin)')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(interaction.user.id !== ADMIN_ID)
        );
        currentRows.push(adminRow);

        try {
          await message.edit({ embeds: [currentEmbed], components: currentRows });
        } catch (e) {
          console.error("Error updating shop message:", e);
          clearInterval(shopTimers.get(message.id)); // Clear interval if message fails to update
          shopTimers.delete(message.id);
        }

        if (timeLeft <= 0) {
          clearInterval(shopTimers.get(message.id));
          shopTimers.delete(message.id);
        }
      };

      if (shopTimers.has(message.id)) {
        clearInterval(shopTimers.get(message.id));
      }
      const timer = setInterval(updateShopCountdown, 1000);
      shopTimers.set(message.id, timer);
      updateShopCountdown(); // Call immediately to show initial countdown
    } else if (command === 'inventory') {
      const page = interaction.options.getInteger('page') || 1;
      
      const processedInventory = [];
      const seedCounts = {};
      const favouritedItems = [];
      const otherItems = [];

      user.inventory.forEach(item => {
          if (item.favourite) {
              favouritedItems.push(item);
          } else if (item.type === 'seed') {
              seedCounts[item.name] = (seedCounts[item.name] || 0) + 1;
          } else {
              otherItems.push(item);
          }
      });

      processedInventory.push(...favouritedItems);

      for (const seedName in seedCounts) {
          processedInventory.push({
              name: seedName,
              type: 'seed',
              quantity: seedCounts[seedName]
          });
      }

      processedInventory.push(...otherItems);

      const totalItems = processedInventory.length;
      const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE; 
      const paginatedInventory = processedInventory.slice(startIndex, endIndex);

      let inventoryList = '';
      if (paginatedInventory.length > 0) {
        inventoryList = paginatedInventory.map((item, index) => {
          let display = '';
          const itemNumber = startIndex + index + 1;

          if (item.type === 'harvested_plant') {
            const mutationsText = item.mutations && item.mutations.length
              ? item.mutations.map(m => formatNameForDisplay(m.name)).join(' ') + ' '
              : '';
            const weightText = item.weight ? `(${item.weight.toFixed(2)}kg)` : '';
            const specialCodeText = item.specialCode ? ` [${item.specialCode}]` : '';
            const favouriteIcon = item.favourite ? '⭐ ' : '';
            display = `${favouriteIcon}${getEmoji('harvested_plant', item.name, 4, item.mutations)} ${mutationsText}${formatNameForDisplay(item.name)}${weightText}${specialCodeText}`;
          } else if (item.type === 'pet_egg') {
            const eggRarity = eggData[item.name]?.rarity || 'Unknown';
            display = `${getEmoji('pet_egg')} ${eggRarity} Egg`; // Display rarity for pet eggs
          } else if (item.type === 'pet') {
            const favouriteIcon = item.favourite ? '⭐ ' : '';
            display = `${favouriteIcon}${getEmoji('pet', item.name)} ${formatNameForDisplay(item.name)} (Age: ${item.age || 0})`;
          }
          else if (item.type === 'seed') {
            display = `${getEmoji('seed', item.name, 0)} ${formatNameForDisplay(item.name)} Seed x${item.quantity}`;
          }
          return `${itemNumber}. ${display}`;
        }).join('\n');
      } else {
        inventoryList = 'Empty';
      }

      const embed = new EmbedBuilder()
        .setTitle('🎒 Your Inventory 🎒')
        .setColor('#00ff00')
        .addFields(
          { name: '💰 Balance', value: `${user.balance} Sheckles`, inline: true },
          { name: `Items (Page ${page}/${totalPages})`, value: inventoryList || 'Empty', inline: false }
        );

      const paginationRow = new ActionRowBuilder();
      paginationRow.addComponents(
        new ButtonBuilder()
          .setCustomId('inv_first_page')
          .setLabel('⏪ First')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`inv_prev_page_${page - 1}`)
          .setLabel('◀️ Back')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`inv_next_page_${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages || totalPages === 0),
        new ButtonBuilder()
          .setCustomId('inv_last_page')
          .setLabel('⏩ Last')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages || totalPages === 0)
      );

      await interaction.editReply({ embeds: [embed], components: [paginationRow] });
    } else if (command === 'leaderboard') {
      const { data: users } = await supabase
        .from('users')
        .select('user_id, balance')
        .order('balance', { ascending: false })
        .limit(5);
      let leaderboard = '🏆 **Top Gardeners** 🏆\n';
      for (const [i, u] of users.entries()) {
        const userObj = await client.users.fetch(u.user_id);
        leaderboard += `${i + 1}. ${userObj.username}: ${u.balance} Sheckles\n`;
      }
      await interaction.editReply(leaderboard);
    } else if (command === 'weather') {
      const weather = await updateWeather();
      await interaction.editReply(`Current Weather: ${weather || 'Clear'}`);
    } else if (command === 'info') {
      const slot = parseInt(interaction.options.getInteger('slot') - 1);
      if (slot < 0 || slot > 8 || !user.garden[slot]) {
        await interaction.editReply('Invalid or empty slot!');
        return;
      }
      const plant = user.garden[slot];
      const price = getSellPrice(plant.name, plant.level, plant.mutations, plant.weight);
      const levelDisplay = plant.level === 4 ? 'Max' : plant.level;
      const embed = new EmbedBuilder()
        .setTitle(`🌱 Slot ${slot + 1} Info`)
        .setColor('#00ff00')
        .addFields(
          { name: 'Plant', value: `${formatNameForDisplay(plant.name)} (Lvl ${levelDisplay})`, inline: true },
          { name: 'Size', value: `${plant.weight.toFixed(2)}kg`, inline: true },
          { name: 'Mutations', value: plant.mutations.length ? plant.mutations.map(m => formatNameForDisplay(m.name)).join(', ') : 'None', inline: true },
          { name: 'Sell Price', value: `${price.toFixed(2)} Sheckles`, inline: true } // Format sell price
        )
        .setFooter({ text: 'Harvest when fully grown (Lvl Max) for max value!' });
      await interaction.editReply({ embeds: [embed] });
    } else if (command === 'favourite') {
      const specialCode = interaction.options.getString('special_code');
      const itemIndex = user.inventory.findIndex(item => 
        (item.type === 'harvested_plant' || item.type === 'pet') && item.specialCode === specialCode
      );

      if (itemIndex === -1) {
        await interaction.editReply(`Could not find an item with code [${specialCode}] in your inventory.`);
        return;
      }

      const item = user.inventory[itemIndex];
      if (item.favourite) {
        await interaction.editReply(`${formatNameForDisplay(item.name)} (Code: [${item.specialCode}]) is already favourited.`);
        return;
      }

      item.favourite = true;
      await supabase
        .from('users')
        .update({ inventory: user.inventory })
        .eq('user_id', interaction.user.id);
      await interaction.editReply(`Favourited ${formatNameForDisplay(item.name)} (Code: [${item.specialCode}]). It will now appear at the front of your inventory and cannot be sold.`);
    } else if (command === 'unfavourite') {
      const specialCode = interaction.options.getString('special_code');
      const itemIndex = user.inventory.findIndex(item => 
        (item.type === 'harvested_plant' || item.type === 'pet') && item.specialCode === specialCode
      );

      if (itemIndex === -1) {
        await interaction.editReply(`Could not find an item with code [${specialCode}] in your inventory.`);
        return;
      }

      const item = user.inventory[itemIndex];
      if (!item.favourite) {
        await interaction.editReply(`${formatNameForDisplay(item.name)} (Code: [${item.specialCode}]) is not favourited.`);
        return;
      }

      item.favourite = false;
      await supabase
        .from('users')
        .update({ inventory: user.inventory })
        .eq('user_id', interaction.user.id);
      await interaction.editReply(`Unfavourited ${formatNameForDisplay(item.name)} (Code: [${item.specialCode}]). It can now be sold.`);
    } else if (command === 'petshop') {
      // Re-fetch user balance for the most up-to-date display
      const { data: currentUserData } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', interaction.user.id)
        .single();
      const currentBalance = currentUserData.balance;

      let { data: petShop, error: petShopError } = await supabase
        .from('pet_eggs_shop')
        .select('*')
        .eq('id', 'global')
        .single();

      if (petShopError || !petShop) {
        await supabase.from('pet_eggs_shop').insert({
          id: 'global',
          stock: {},
          last_restock: new Date().toISOString()
        }).select('*').single();
        ({ data: petShop } = await supabase
          .from('pet_eggs_shop')
          .select('*')
          .eq('id', 'global')
          .single());
      }

      const petStock = petShop.stock || {}; // This now contains egg types as keys
      const lastRestock = petShop.last_restock ? new Date(petShop.last_restock) : new Date();
      const now = Date.now();
      const timeSinceLastRestock = now - lastRestock.getTime();
      const cyclesSinceLastRestock = Math.floor(timeSinceLastRestock / petRestockInterval);
      const nextRestockTime = lastRestock.getTime() + (cyclesSinceLastRestock + 1) * petRestockInterval;
      const nextRestockTimestamp = Math.floor(nextRestockTime / 1000);

      const embed = new EmbedBuilder()
        .setTitle('🐾 Pet Egg Shop 🐾')
        .setColor('#FFD700')
        .addFields(
          { name: '💰 Your Balance', value: `${currentBalance} Sheckles`, inline: true },
          { name: '⏰ Next Restock', value: `<t:${nextRestockTimestamp}:R>`, inline: true }
        );

      let stockDescription = '';
      let eggsAvailable = false;
      Object.entries(petStock).forEach(([eggType, quantity]) => {
        if (quantity > 0 && eggData[eggType] && eggData[eggType].eggsShop) { // Ensure egg exists and is available in shop
          const eggInfo = eggData[eggType];
          stockDescription += `${getEmoji('pet_egg')} ${eggInfo.rarity} Egg - ${eggInfo.cost} Sheckles (x${quantity})\n`;
          eggsAvailable = true;
        }
      });

      if (eggsAvailable) {
        embed.addFields({ name: 'Available Pet Eggs', value: stockDescription });
      } else {
        embed.addFields({ name: 'Available Pet Eggs', value: 'No pet eggs in stock!' });
      }

      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;
      let rowCount = 0; // Track number of rows for pet eggs

      const petShopItems = Object.entries(petStock).filter(([eggType, quantity]) => quantity > 0 && eggData[eggType] && eggData[eggType].eggsShop);

      for (const [eggType, quantity] of petShopItems) {
        if (rowCount < 5) { // Limit pet egg rows to 5
          if (buttonCount === 3) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
            rowCount++;
            if (rowCount >= 5) break; // Stop adding new rows if limit reached
          }
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_pet_egg_${eggType}`) // Custom ID now uses eggType
              .setLabel(`Buy ${eggData[eggType].rarity} Egg`) // Label uses rarity
              .setStyle(ButtonStyle.Primary)
              .setEmoji(getEmoji('pet_egg'))
              .setDisabled(quantity <= 0)
          );
          buttonCount++;
        }
      }
      if (buttonCount > 0 && rowCount < 5) rows.push(currentRow); // Push the last incomplete row if space allows

      const message = await interaction.editReply({ embeds: [embed], components: rows });

      // Define updatePetShopCountdown function that can access `message`
      const updatePetShopCountdown = async () => {
        const now = Date.now();
        const timeLeft = Math.max(0, nextRestockTime - now);

        // Re-fetch latest pet shop data for accurate display
        const { data: currentPetShopData } = await supabase
          .from('pet_eggs_shop')
          .select('stock, last_restock')
          .eq('id', 'global')
          .single();
        const currentPetStock = currentPetShopData?.stock || {};
        const currentLastPetRestock = currentPetShopData?.last_restock ? new Date(currentPetShopData.last_restock) : new Date();
        const currentNextPetRestockTime = currentLastPetRestock.getTime() + (Math.floor((now - currentLastPetRestock.getTime()) / petRestockInterval) + 1) * petRestockInterval;

        // Re-fetch user balance for the most up-to-date display
        const { data: currentBalanceData } = await supabase
          .from('users')
          .select('balance')
          .eq('user_id', interaction.user.id)
          .single();
        const currentDisplayBalance = currentBalanceData?.balance || 0;

        const currentEmbed = new EmbedBuilder()
          .setTitle('🐾 Pet Egg Shop 🐾')
          .setColor('#FFD700')
          .addFields(
            { name: '💰 Your Balance', value: `${currentDisplayBalance} Sheckles`, inline: true },
            { name: '⏰ Next Restock', value: timeLeft <= 0 ? 'Pet shop has restocked!' : `<t:${Math.floor(currentNextPetRestockTime / 1000)}:R>`, inline: true }
          );

        let currentStockDescription = '';
        let eggsAvailable = false;
        Object.entries(currentPetStock).forEach(([eggType, quantity]) => {
          if (quantity > 0 && eggData[eggType] && eggData[eggType].eggsShop) {
            const eggInfo = eggData[eggType];
            currentStockDescription += `${getEmoji('pet_egg')} ${eggInfo.rarity} Egg - ${eggInfo.cost} Sheckles (x${quantity})\n`;
            eggsAvailable = true;
          }
        });
        currentEmbed.addFields({ name: 'Available Pet Eggs', value: currentStockDescription || 'No pet eggs in stock!' });

        const currentRows = [];
        let currentPetRow = new ActionRowBuilder();
        let currentButtonCount = 0;
        let currentRowCount = 0;

        const currentPetShopItems = Object.entries(currentPetStock).filter(([eggType, quantity]) => quantity > 0 && eggData[eggType] && eggData[eggType].eggsShop);

        for (const [eggType, quantity] of currentPetShopItems) {
          if (currentRowCount < 5) {
            if (currentButtonCount === 3) {
              currentRows.push(currentPetRow);
              currentPetRow = new ActionRowBuilder();
              currentButtonCount = 0;
              currentRowCount++;
              if (currentRowCount >= 5) break;
            }
            currentPetRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`buy_pet_egg_${eggType}`)
                .setLabel(`Buy ${eggData[eggType].rarity} Egg`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(getEmoji('pet_egg'))
                .setDisabled(quantity <= 0)
            );
            currentButtonCount++;
          }
        }
        if (currentButtonCount > 0 && currentRowCount < 5) currentRows.push(currentPetRow);

        try {
          await message.edit({ embeds: [currentEmbed], components: currentRows });
        } catch (e) {
          console.error("Error updating pet shop message:", e);
          clearInterval(shopTimers.get(message.id));
          shopTimers.delete(message.id);
        }

        if (timeLeft <= 0) {
          clearInterval(shopTimers.get(message.id));
          shopTimers.delete(message.id);
        }
      };

      if (shopTimers.has(message.id)) {
        clearInterval(shopTimers.get(message.id));
      }
      const timer = setInterval(updatePetShopCountdown, 1000);
      shopTimers.set(message.id, timer);
      updatePetShopCountdown(); // Call immediately to show initial countdown

    } else if (command === 'hatch') {
      const inventoryIndex = interaction.options.getInteger('inventory_index') - 1;

      if (inventoryIndex < 0 || inventoryIndex >= user.inventory.length) {
        await interaction.editReply('Invalid inventory index.');
        return;
      }

      const itemToHatch = user.inventory[inventoryIndex];

      if (!itemToHatch || itemToHatch.type !== 'pet_egg') {
        await interaction.editReply('The selected item is not a pet egg.');
        return;
      }

      if (!(await checkInventoryCapacity(userId))) {
        await interaction.editReply('Your inventory is full! Max 200 items. Make space for your new pet.');
        return;
      }

      const eggType = itemToHatch.name; // This is now the egg type, e.g., 'common_egg'
      const hatchedPetName = choosePetToHatch(eggType); // Use the new function to get the pet name

      if (!hatchedPetName) {
        await interaction.editReply('Error: Could not determine which pet to hatch from this egg.');
        return;
      }

      const petData = petsData[hatchedPetName];

      if (!petData) {
        await interaction.editReply('Error: Pet data not found for the hatched pet.');
        return;
      }

      const newInventory = [...user.inventory];
      newInventory.splice(inventoryIndex, 1);

      const newPet = {
        name: hatchedPetName, // Store the actual pet name
        type: 'pet',
        rarity: petData.rarity,
        trait: petData.trait,
        weight: petData.baseWeight,
        age: 0,
        xp: 0,
        hunger: 100,
        lastFed: new Date().toISOString(),
        specialCode: generateSpecialCode(),
        favourite: false,
        equipped: false
      };
      newInventory.push(newPet);

      await supabase
        .from('users')
        .update({ inventory: newInventory })
        .eq('user_id', userId); // Use userId directly

      await interaction.editReply(`You hatched a ${getEmoji('pet', hatchedPetName)} **${formatNameForDisplay(hatchedPetName)}** (${petData.rarity})! Its special code is [${newPet.specialCode}].`);
    } else if (command === 'shovel') {
      const slot = interaction.options.getInteger('slot') - 1; // Adjust for 0-indexed array

      if (slot < 0 || slot > 8) {
        await interaction.editReply('Invalid slot! Please choose a number between 1 and 9.');
        return;
      }

      if (!user.garden[slot]) {
        await interaction.editReply('That garden slot is already empty!');
        return;
      }

      const plantName = formatNameForDisplay(user.garden[slot].name);
      const newGarden = [...user.garden];
      newGarden[slot] = null; // Remove the plant

      await supabase
        .from('users')
        .update({ garden: newGarden })
        .eq('user_id', interaction.user.id);

      await interaction.editReply(`You shoveled the ${plantName} from slot ${slot + 1}. The slot is now empty.`);
    } else if (command === 'tracker') {
      const trackerEmbed = new EmbedBuilder()
        .setTitle('🔔 Notification Tracker 🔔')
        .setDescription('Select a category to manage your tracking preferences.')
        .setColor('#0099ff');

      const trackerButtons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('tracker_category_plant')
            .setLabel('Track Plants')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🌱'),
          new ButtonBuilder()
            .setCustomId('tracker_category_egg')
            .setLabel('Track Eggs')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🥚'),
          new ButtonBuilder()
            .setCustomId('tracker_category_weather')
            .setLabel('Track Weather')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('☀️')
        );
      
      // Removed ephemeral: true to make it visible to everyone
      await interaction.editReply({ embeds: [trackerEmbed], components: [trackerButtons] });

    }
    // Admin Commands - These commands are now hidden from non-admins in the Discord UI
    // The `isAdminCommand` check at the beginning of the interaction handles the ephemeral reply.
    else if (interaction.user.id !== ADMIN_ID) {
      await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }
    else if (command === 'initroles') {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply('This command can only be used in a server.');
        return;
      }

      await interaction.editReply('Initializing roles... This might take a moment.');

      const existingRoles = guild.roles.cache;
      let rolesCreated = 0;

      // Helper to create and store role
      const createAndStoreRole = async (type, name, emoji, color) => {
        const roleName = getRoleName(type, name); // Use the updated getRoleName
        const roleIdInDb = `${type}_${name}`;

        const { data: existingRoleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', roleIdInDb).single();
        if (existingRoleMap) {
          // Check if Discord role still exists
          if (guild.roles.cache.has(existingRoleMap.role_id)) {
            console.log(`Role "${roleName}" already exists and mapped. Skipping.`);
            return;
          } else {
            console.log(`Mapped role "${roleName}" not found in Discord, recreating.`);
            await supabase.from('discord_roles_map').delete().eq('id', roleIdInDb); // Clean up old mapping
          }
        }

        const discordRole = existingRoles.find(r => r.name === roleName);
        let role;
        if (discordRole) {
          role = discordRole;
          console.log(`Found existing Discord role: ${roleName}`);
        } else {
          try {
            role = await guild.roles.create({
              name: roleName,
              color: color,
              mentionable: true, // Allow mentioning for notifications
              hoist: false, // Don't display separately in member list
              reason: 'DVMS Garden Bot Role for Notifications',
            });
            console.log(`Created Discord role: ${roleName}`);
            rolesCreated++;
          } catch (e) {
            console.error(`Failed to create role ${roleName}:`, e);
            return;
          }
        }
        
        // Update role emoji if possible (Discord.js v14 doesn't directly support role emojis)
        // This is a placeholder for future Discord API features or bot integrations
        // For now, the emoji is just part of the role name/display in the bot's messages.

        // Store mapping in Supabase
        await supabase.from('discord_roles_map').upsert({
          id: roleIdInDb,
          role_id: role.id,
          type: type,
          name: name
        });
      };

      // Plants
      for (const plantName in plants) {
        await createAndStoreRole('plant', plantName, getEmoji('seed', plantName, 0), getRoleColor('plant', plantName));
      }

      // Eggs
      for (const eggType in eggData) {
        if (eggData[eggType].eggsShop) { // Only create roles for eggs available in shop
          await createAndStoreRole('egg', eggType, getEmoji('pet_egg'), getRoleColor('egg', eggType));
        }
      }

      // Weather
      for (const weatherType in weatherData) {
        await createAndStoreRole('weather', weatherType, weatherData[weatherType].emoji, getRoleColor('weather', weatherType));
      }

      await interaction.editReply(`Role initialization complete. Created/updated ${rolesCreated} roles.`);

    } else if (command === 'resetstock') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const newStock = getRandomPlants({});
      await supabase
        .from('shop')
        .upsert({ id: 'global', stock: newStock, last_restock: new Date().toISOString() });
      await interaction.editReply('Shop stock reset successfully!');
    } else if (command === 'addbalance') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const { data: target } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', targetUser.id)
        .single();
      await supabase
        .from('users')
        .update({ balance: (target.balance || 0) + amount })
        .eq('user_id', targetUser.id);
      await interaction.editReply(`Added ${amount} Sheckles to ${targetUser.username}'s balance!`);
    } else if (command === 'clearinventory') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user');
      await supabase
        .from('users')
        .update({ inventory: [] })
        .eq('user_id', targetUser.id);
      await interaction.editReply(`Cleared ${targetUser.username}'s inventory!`);
    } else if (command === 'globalswarm') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const swarmType = Math.random() < 0.5 ? 'bee_swarm' : 'worker_bee_swarm';
      const { error: updateError } = await supabase.from('weather').upsert({
        type: swarmType,
        start_time: new Date().toISOString(),
        duration: weatherData[swarmType].duration
      });
      if (updateError) {
        console.error("Error setting global swarm:", updateError);
        await interaction.editReply('Failed to set global swarm.');
      } else {
        await interaction.editReply(`Global weather set to **${formatNameForDisplay(swarmType)}**!`);
        // No need to send notification here, as the cron job will pick it up and notify
      }
    } else if (command === 'globalbloodmoon') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const { error: updateError } = await supabase.from('weather').upsert({
        type: 'blood_moon',
        start_time: new Date().toISOString(),
        duration: weatherData.blood_moon.duration
      });
      if (updateError) {
        console.error("Error setting global blood moon:", updateError);
        await interaction.editReply('Failed to set global blood moon.');
      } else {
        await interaction.editReply('Global weather set to **Blood Moon**!');
        // No need to send notification here, as the cron job will pick it up and notify
      }
    } else if (command === 'givepet') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user');
      const petName = interaction.options.getString('pet_name').toLowerCase();

      if (!petsData[petName]) {
        await interaction.editReply(`Pet "${petName}" not found. Please provide a valid pet name.`);
        return;
      }

      const { data: targetUserData, error: targetUserError } = await supabase
        .from('users')
        .select('inventory')
        .eq('user_id', targetUser.id)
        .single();

      if (targetUserError || !targetUserData) {
        console.error(`Error fetching target user ${targetUser.id}:`, targetUserError);
        await interaction.editReply('Could not fetch target user data.');
        return;
      }

      if (targetUserData.inventory.length >= MAX_INVENTORY_SIZE) {
        await interaction.editReply(`${targetUser.username}'s inventory is full! Max ${MAX_INVENTORY_SIZE} items.`);
        return;
      }

      const newPet = {
        name: petName,
        type: 'pet',
        rarity: petsData[petName].rarity,
        trait: petsData[petName].trait,
        weight: petsData[petName].baseWeight,
        age: 0,
        xp: 0,
        hunger: 100,
        lastFed: new Date().toISOString(),
        specialCode: generateSpecialCode(),
        favourite: false,
        equipped: false
      };

      const updatedInventory = [...targetUserData.inventory, newPet];

      await supabase
        .from('users')
        .update({ inventory: updatedInventory })
        .eq('user_id', targetUser.id);

      await interaction.editReply(`Gave ${formatNameForDisplay(petName)} to ${targetUser.username}!`);
    } else if (command === 'giveseed') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user');
      const seedName = interaction.options.getString('seed_name').toLowerCase();
      const quantity = interaction.options.getInteger('quantity') || 1;

      if (!plants[seedName]) {
        await interaction.editReply(`Seed "${seedName}" not found. Please provide a valid seed name.`);
        return;
      }

      const { data: targetUserData, error: targetUserError } = await supabase
        .from('users')
        .select('inventory')
        .eq('user_id', targetUser.id)
        .single();

      if (targetUserError || !targetUserData) {
        console.error(`Error fetching target user ${targetUser.id}:`, targetUserError);
        await interaction.editReply('Could not fetch target user data.');
        return;
      }

      if (targetUserData.inventory.length + quantity > MAX_INVENTORY_SIZE) {
        await interaction.editReply(`${targetUser.username}'s inventory does not have enough space for ${quantity} seeds. Max ${MAX_INVENTORY_SIZE} items.`);
        return;
      }

      const newSeeds = [];
      for (let i = 0; i < quantity; i++) {
        newSeeds.push({
          name: seedName,
          mutations: [],
          weight: plants[seedName].baseWeight,
          type: 'seed'
        });
      }

      const updatedInventory = [...targetUserData.inventory, ...newSeeds];

      await supabase
        .from('users')
        .update({ inventory: updatedInventory })
        .eq('user_id', targetUser.id);

      await interaction.editReply(`Gave ${quantity}x ${formatNameForDisplay(seedName)} seed(s) to ${targetUser.username}!`);
    } else if (command === 'setweather') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const weatherType = interaction.options.getString('weather_type').toLowerCase();

      if (!weatherData[weatherType]) {
        await interaction.editReply(`Weather type "${weatherType}" not found. Please provide a valid weather type.`);
        return;
      }

      const { error: updateError } = await supabase.from('weather').upsert({
        type: weatherType,
        start_time: new Date().toISOString(),
        duration: weatherData[weatherType].duration || 3600 // Default to 1 hour if not specified
      });

      if (updateError) {
        console.error("Error setting global weather:", updateError);
        await interaction.editReply('Failed to set global weather.');
      } else {
        await interaction.editReply(`Global weather set to **${formatNameForDisplay(weatherType)}**!`);
        // Explicitly send notification for manual weather change
        const { data: roleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', `weather_${weatherType}`).single();
        if (roleMap?.role_id) {
            await sendNotification('weather', weatherType, roleMap.role_id);
        }
      }
    } else if (command === 'gift') {
        if (interaction.user.id !== ADMIN_ID) {
            await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }
        const targetUser = interaction.options.getUser('user');
        const specialCode = interaction.options.getString('special_code');

        // Check if the admin has the item in their inventory
        const adminItemIndex = user.inventory.findIndex(item => item.specialCode === specialCode);

        if (adminItemIndex === -1) {
            await interaction.editReply(`You do not have an item with the special code [${specialCode}] in your inventory.`);
            return;
        }

        const itemToGift = user.inventory[adminItemIndex];

        // Prevent gifting seeds or un-giftable types if necessary (adjust logic as needed)
        if (itemToGift.type === 'seed' || itemToGift.type === 'pet_egg') {
            await interaction.editReply(`You can only gift harvested plants or pets with special codes.`);
            return;
        }

        // Fetch target user's data
        const { data: targetUserData, error: targetUserError } = await supabase
            .from('users')
            .select('inventory')
            .eq('user_id', targetUser.id)
            .single();

        if (targetUserError || !targetUserData) {
            console.error(`Error fetching target user ${targetUser.id}:`, targetUserError);
            await interaction.editReply('Could not fetch target user data.');
            return;
        }

        // Check if target user's inventory is full
        if (targetUserData.inventory.length >= MAX_INVENTORY_SIZE) {
            await interaction.editReply(`${targetUser.username}'s inventory is full! They need to make space.`);
            return;
        }

        // Remove item from admin's inventory
        const adminNewInventory = [...user.inventory];
        adminNewInventory.splice(adminItemIndex, 1);
        await supabase
            .from('users')
            .update({ inventory: adminNewInventory })
            .eq('user_id', interaction.user.id);

        // Add item to target user's inventory
        const targetNewInventory = [...targetUserData.inventory, itemToGift];
        await supabase
            .from('users')
            .update({ inventory: targetNewInventory })
            .eq('user_id', targetUser.id);

        await interaction.editReply(`Successfully gifted ${formatNameForDisplay(itemToGift.name)} (Code: [${specialCode}]) to ${targetUser.username}!`);
    } else if (command === 'seedadd') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }
      const seedName = interaction.options.getString('seed_name').toLowerCase();
      const quantity = interaction.options.getInteger('quantity');

      if (!plants[seedName]) {
        await interaction.editReply(`Seed "${seedName}" not found. Please provide a valid seed name.`);
        return;
      }
      if (quantity <= 0) {
        await interaction.editReply('Quantity must be a positive number.');
        return;
      }

      let { data: shop, error: shopError } = await supabase
        .from('shop')
        .select('stock')
        .eq('id', 'global')
        .single();

      if (shopError || !shop) {
        shop = { stock: {} }; // Initialize if no shop entry exists
      }

      const currentStock = shop.stock || {};
      currentStock[seedName] = (currentStock[seedName] || 0) + quantity;

      await supabase
        .from('shop')
        .upsert({ id: 'global', stock: currentStock, last_restock: new Date().toISOString() });

      await interaction.editReply(`Added ${quantity}x ${formatNameForDisplay(seedName)} to Sam's Shop!`);

      // Send notification to tracker channel
      const { data: roleMap } = await supabase.from('discord_roles_map').select('role_id').eq('id', `plant_${seedName}`).single();
      if (roleMap?.role_id) {
        await sendNotification('plant', seedName, roleMap.role_id);
      } else {
        // If no specific role, send a general notification
        await sendNotification('plant', seedName, null); 
      }
    }
  } else if (interaction.isButton()) {
    // For tracker related buttons, the reply should be public.
    // For other buttons (like buy, info), it can remain ephemeral if desired.
    const isTrackerButton = interaction.customId.startsWith('tracker_category_');
    await interaction.deferReply({ ephemeral: !isTrackerButton }); 

    const userId = interaction.user.id;
    await initUser(userId);
    const { data: user, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (userFetchError || !user) {
      console.error(`Failed to fetch user ${userId} on button interaction:`, userFetchError);
      if (!interaction.replied) {
        await interaction.editReply({ content: 'There was an error fetching your data. Please try again later.', ephemeral: true }); // Keep error messages ephemeral
      }
      return;
    }
    
    if (interaction.customId.startsWith('buy_') || interaction.customId === 'restock_now') {
      // This clearInterval is for the shop/petshop countdown timer.
      // It's crucial to clear the interval associated with the message ID.
      if (shopTimers.has(interaction.message.id)) {
        clearInterval(shopTimers.get(interaction.message.id));
        shopTimers.delete(interaction.message.id);
      }
    }

    if (isTrackerButton) {
      const category = interaction.customId.replace('tracker_category_', ''); // 'plant', 'egg', 'weather'

      const { data: allRolesData, error: rolesError } = await supabase
        .from('discord_roles_map')
        .select('*')
        .eq('type', category);

      if (rolesError || !allRolesData) {
        console.error(`Error fetching roles for category ${category}:`, rolesError);
        await interaction.editReply('Failed to load tracking options. Please try again.');
        return;
      }

      const { data: userPrefs, error: prefsError } = await supabase
        .from('user_tracking_preferences')
        .select('tracked_role_ids')
        .eq('user_id', userId)
        .single();
      const trackedRoleIds = userPrefs?.tracked_role_ids || [];

      const options = allRolesData.map(role => {
        const isDefaultEmoji = role.type === 'plant' && getEmoji('seed', role.name, 0) === '🌱';
        const emoji = isDefaultEmoji ? '🌱' : getRoleEmoji(role.type, role.name); // Use specific emoji if available, else default
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${emoji} ${formatNameForDisplay(role.name)}`)
          .setValue(role.role_id)
          .setDefault(trackedRoleIds.includes(role.role_id));
      });

      const selectMenu = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`tracker_select_${category}`)
            .setPlaceholder(`Select ${formatNameForDisplay(category)}s to track...`)
            .setMinValues(0)
            .setMaxValues(options.length > 0 ? options.length : 1) // Allow selecting all or none
            .addOptions(options.length > 0 ? options : [{ label: 'No items in this category', value: 'no_options', default: false, description: 'No trackable items found.' }])
        );
      
      const embed = new EmbedBuilder()
        .setTitle(`🔔 Track ${formatNameForDisplay(category)} Notifications 🔔`)
        .setDescription(`Select the ${formatNameForDisplay(category)} types you want to receive notifications for.`)
        .setColor('#0099ff');

      await interaction.editReply({ embeds: [embed], components: [selectMenu] });

    } else if (interaction.customId.startsWith('buy_')) {
      const parts = interaction.customId.split('_');
      const itemType = parts[1];

      if (itemType === 'pet' && parts[2] === 'egg') {
        const eggType = parts.slice(3).join('_'); // Get the full egg type name
        const eggInfo = eggData[eggType];

        if (!eggInfo || !eggInfo.eggsShop) {
          await interaction.editReply({ content: 'This egg is not available in the shop!' });
          return;
        }

        const cost = eggInfo.cost;

        let { data: currentPetShop, error: currentPetShopError } = await supabase
          .from('pet_eggs_shop')
          .select('stock')
          .eq('id', 'global')
          .single();
        
        if (currentPetShopError || !currentPetShop) {
          const { data: newPetShopData, error: insertPetShopError } = await supabase.from('pet_eggs_shop').insert({
            id: 'global',
            stock: {},
            last_restock: new Date().toISOString()
          }).select('*').single();
          if (insertPetShopError) {
              console.error("Error initializing pet shop:", insertPetShopError);
              await interaction.editReply("Error initializing pet shop. Please try again.");
              return;
          }
          currentPetShop = newPetShopData;
        }

        if (!currentPetShop.stock[eggType] || currentPetShop.stock[eggType] <= 0) {
          await interaction.editReply({ content: 'This pet egg is out of stock!' });
          return;
        }
        if (user.balance < cost) {
          await interaction.editReply({ content: `You need ${cost} Sheckles to buy the ${eggInfo.rarity} Egg!` });
          return;
        }
        if (!(await checkInventoryCapacity(userId))) {
          await interaction.editReply({ content: 'Your inventory is full! Max 200 items. Make space for your new egg.' });
          return;
        }

        currentPetShop.stock[eggType] -= 1;
        await supabase
          .from('pet_eggs_shop')
          .update({ stock: currentPetShop.stock })
          .eq('id', 'global');

        await supabase
          .from('users')
          .update({
            balance: user.balance - cost,
            inventory: [...user.inventory, { name: eggType, type: 'pet_egg' }], // Store eggType in inventory
          })
          .eq('user_id', userId);

        await interaction.editReply({ content: `Bought ${eggInfo.rarity} Egg for ${cost} Sheckles!`, ephemeral: true }); // Keep buy confirmation ephemeral

        // Re-fetch latest shop data and user balance to update the message
        const { data: updatedPetShop } = await supabase
          .from('pet_eggs_shop')
          .select('stock, last_restock')
          .eq('id', 'global')
          .single();
        const updatedPetStock = updatedPetShop.stock;
        const lastPetRestock = updatedPetShop.last_restock ? new Date(updatedPetShop.last_restock) : new Date();
        const now = Date.now();
        const timeSinceLastPetRestock = now - lastPetRestock.getTime();
        const cyclesSinceLastPetRestock = Math.floor(timeSinceLastPetRestock / petRestockInterval);
        const nextPetRestockTime = lastPetRestock.getTime() + (cyclesSinceLastPetRestock + 1) * petRestockInterval;
        
        const { data: currentUserBalance } = await supabase
          .from('users')
          .select('balance')
          .eq('user_id', userId)
          .single();

        const embed = new EmbedBuilder()
          .setTitle('🐾 Pet Egg Shop 🐾')
          .setColor('#FFD700')
          .addFields(
            { name: '💰 Your Balance', value: `${currentUserBalance.balance} Sheckles`, inline: true },
            { name: '⏰ Next Restock', value: `<t:${Math.floor(nextPetRestockTime / 1000)}:R>`, inline: true }
          );

        let stockDescription = '';
        let eggsAvailable = false;
        Object.entries(updatedPetStock).forEach(([pEggType, pQuantity]) => {
          if (pQuantity > 0 && eggData[pEggType] && eggData[pEggType].eggsShop) {
            const pEggInfo = eggData[pEggType];
            stockDescription += `${getEmoji('pet_egg')} ${pEggInfo.rarity} Egg - ${pEggInfo.cost} Sheckles (x${pQuantity})\n`;
            eggsAvailable = true;
          }
        });
        embed.addFields({ name: 'Available Pet Eggs', value: stockDescription || 'No pet eggs in stock!' });

        const rows = [];
        let currentRow = new ActionRowBuilder();
        let buttonCount = 0;
        let rowCount = 0; // Track number of rows for pet eggs

        const petShopItems = Object.entries(updatedPetStock).filter(([eggType, quantity]) => quantity > 0 && eggData[eggType] && eggData[eggType].eggsShop);

        for (const [eggType, quantity] of petShopItems) {
          if (rowCount < 5) { // Limit pet egg rows to 5
            if (buttonCount === 3) {
              rows.push(currentRow);
              currentRow = new ActionRowBuilder();
              buttonCount = 0;
              rowCount++;
              if (rowCount >= 5) break; // Stop adding new rows if limit reached
            }
            currentRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`buy_pet_egg_${eggType}`)
                .setLabel(`Buy ${eggData[eggType].rarity} Egg`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(getEmoji('pet_egg'))
                .setDisabled(quantity <= 0)
            );
            buttonCount++;
          }
        }
        if (buttonCount > 0 && rowCount < 5) rows.push(currentRow); // Push the last incomplete row if space allows

        await interaction.message.edit({ embeds: [embed], components: rows }).catch(e => console.error("Error updating pet shop message:", e));
        return;
      }
      const seed = interaction.customId.replace('buy_', '');
      let { data: shop } = await supabase
        .from('shop')
        .select('stock, last_restock')
        .eq('id', 'global')
        .single();

      if (!shop) {
        const { data: newShopData, error: insertShopError } = await supabase.from('shop').insert({
          id: 'global',
          stock: {},
          last_restock: new Date().toISOString()
        }).select('*').single();
        if (insertShopError) {
            console.error("Error initializing shop:", insertShopError);
            await interaction.editReply("Error initializing shop. Please try again.");
            return;
        }
        shop = newShopData;
      }
      const stock = shop?.stock || {};

      // Ensure plants[seed] exists before proceeding
      if (!plants[seed] || stock[seed] <= 0) {
        await interaction.editReply({ content: 'This seed is out of stock or does not exist!' });
        return;
      }
      const cost = plants[seed].cost;
      if (user.balance < cost) {
        await interaction.editReply({ content: `You need ${cost} Sheckles to buy ${formatNameForDisplay(seed)}!` });
        return;
      }
      if (!(await checkInventoryCapacity(userId))) {
        await interaction.editReply({ content: 'Your inventory is full! Max 200 items. Make space for your new seed.' });
        return;
      }

      stock[seed] -= 1;
      await supabase
        .from('shop')
        .update({ stock })
        .eq('id', 'global');
      await supabase
        .from('users')
        .update({
          balance: user.balance - cost,
          inventory: [...user.inventory, { name: seed, mutations: [], weight: plants[seed].baseWeight, type: 'seed' }],
        })
        .eq('user_id', userId);

      // Re-fetch latest shop data and user balance to update the message
      const { data: updatedShop } = await supabase
        .from('shop')
        .select('stock, last_restock')
        .eq('id', 'global')
        .single();
      const updatedStock = updatedShop.stock;
      const lastRestock = updatedShop.last_restock ? new Date(updatedShop.last_restock) : new Date();
      const restockInterval = 5 * 60 * 1000;
      const now = Date.now();
      const timeSinceLastRestock = now - lastRestock.getTime();
      const cyclesSinceLastRestock = Math.floor(timeSinceLastRestock / restockInterval);
      const nextRestockTime = lastRestock.getTime() + (cyclesSinceLastRestock + 1) * restockInterval;
      
      const { data: currentUserBalance } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', userId)
        .single();

      const embed = new EmbedBuilder()
        .setTitle('🌱 Sam\'s Seed Shop 🌱')
        .setColor('#00ff00')
        .addFields(
          { name: '💰 Your Balance', value: `${currentUserBalance.balance} Sheckles`, inline: true },
          { name: '⏰ Next Restock', value: `<t:${Math.floor(nextRestockTime / 1000)}:R>`, inline: true }
        );

      let stockDescription = '';
      Object.entries(updatedStock).forEach(([sName, sQuantity]) => {
        if (sQuantity > 0 && plants[sName]) { 
          const basePrice = plants[sName].cost;
          stockDescription += `${formatNameForDisplay(sName)} Seed (${plants[sName].rarity}) - ${basePrice} Sheckles (x${sQuantity})\n`;
        }
      });

      if (stockDescription) {
        embed.addFields({ name: 'Available Seeds', value: stockDescription });
      } else {
        embed.addFields({ name: 'Available Seeds', value: 'No seeds in stock!' });
      }

      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;
      let shopRowCount = 0;

      const shopItems = Object.entries(updatedStock).filter(([seed, quantity]) => quantity > 0 && plants[seed]);

      for (const [seed, quantity] of shopItems) {
        if (shopRowCount < 4) {
          if (buttonCount === 3) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
            shopRowCount++;
            if (shopRowCount >= 4) break;
          }
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${seed}`)
              .setLabel(`Buy ${formatNameForDisplay(seed)} Seed x${quantity}`)
              .setStyle(ButtonStyle.Primary)
              .setEmoji(getEmoji('plant', seed, 0))
              .setDisabled(quantity <= 0)
          );
          buttonCount++;
        }
      }
      if (buttonCount > 0 && shopRowCount < 4) rows.push(currentRow);

      const adminRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('restock_now')
          .setLabel('Restock Now (Admin)')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(interaction.user.id !== ADMIN_ID)
      );
      rows.push(adminRow);

      await interaction.message.edit({ embeds: [embed], components: rows }).catch(e => console.error("Error updating shop message:", e));
      await interaction.editReply({ content: `Bought ${formatNameForDisplay(seed)} for ${cost} Sheckles!`, ephemeral: true });
    } else if (interaction.customId === 'restock_now') {
      if (interaction.user.id !== ADMIN_ID) {
        await interaction.editReply({ content: 'You do not have permission to use this button.', ephemeral: true });
        return;
      }
      const newStock = getRandomPlants({});
      await supabase
        .from('shop')
        .upsert({ id: 'global', stock: newStock, last_restock: new Date().toISOString() });
      await interaction.editReply({ content: 'Shop stock reset successfully!', ephemeral: true });

      // Re-fetch shop data to update the message
      const { data: updatedShop } = await supabase
        .from('shop')
        .select('stock, last_restock')
        .eq('id', 'global')
        .single();
      const updatedStock = updatedShop.stock;

      const lastRestock = updatedShop.last_restock ? new Date(updatedShop.last_restock) : new Date();
      const restockInterval = 5 * 60 * 1000;
      const now = Date.now();
      const timeSinceLastRestock = now - lastRestock.getTime();
      const cyclesSinceLastRestock = Math.floor(timeSinceLastRestock / restockInterval);
      const nextRestockTime = lastRestock.getTime() + (cyclesSinceLastRestock + 1) * restockInterval;
      
      const { data: currentUserBalance } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', userId)
        .single();

      const embed = new EmbedBuilder()
        .setTitle('🌱 Sam\'s Seed Shop 🌱')
        .setColor('#00ff00')
        .addFields(
          { name: '💰 Your Balance', value: `${currentUserBalance.balance} Sheckles`, inline: true },
          { name: '⏰ Next Restock', value: `<t:${Math.floor(nextRestockTime / 1000)}:R>`, inline: true }
        );

      let stockDescription = '';
      Object.entries(updatedStock).forEach(([seed, quantity]) => {
        if (quantity > 0 && plants[seed]) {
          const basePrice = plants[seed].cost;
          stockDescription += `${formatNameForDisplay(seed)} Seed (${plants[seed].rarity}) - ${basePrice} Sheckles (x${quantity})\n`;
        }
      });

      if (stockDescription) {
        embed.addFields({ name: 'Available Seeds', value: stockDescription });
      } else {
        embed.addFields({ name: 'Available Seeds', value: 'No seeds in stock!' });
      }

      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;
      let shopRowCount = 0;

      const shopItems = Object.entries(updatedStock).filter(([seed, quantity]) => quantity > 0 && plants[seed]);

      for (const [seed, quantity] of shopItems) {
        if (shopRowCount < 4) {
          if (buttonCount === 3) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
            shopRowCount++;
            if (shopRowCount >= 4) break;
          }
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${seed}`)
              .setLabel(`Buy ${formatNameForDisplay(seed)} Seed x${quantity}`)
              .setStyle(ButtonStyle.Primary)
              .setEmoji(getEmoji('plant', seed, 0))
              .setDisabled(quantity <= 0)
          );
          buttonCount++;
        }
      }
      if (buttonCount > 0 && shopRowCount < 4) rows.push(currentRow);

      const adminRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('restock_now')
          .setLabel('Restock Now (Admin)')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(interaction.user.id !== ADMIN_ID)
      );
      rows.push(adminRow);

      await interaction.message.edit({ embeds: [embed], components: rows }).catch(e => console.error("Error updating shop message after restock:", e));
    } else if (interaction.customId.startsWith('inv_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      let page = parseInt(parts[3]) || 1; // For next/prev page

      const processedInventory = [];
      const seedCounts = {};
      const favouritedItems = [];
      const otherItems = [];

      user.inventory.forEach(item => {
          if (item.favourite) {
              favouritedItems.push(item);
          } else if (item.type === 'seed') {
              seedCounts[item.name] = (seedCounts[item.name] || 0) + 1;
          } else {
              otherItems.push(item);
          }
      });

      processedInventory.push(...favouritedItems);

      for (const seedName in seedCounts) {
          processedInventory.push({
              name: seedName,
              type: 'seed',
              quantity: seedCounts[seedName]
          });
      }

      processedInventory.push(...otherItems);

      const totalItems = processedInventory.length;
      const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

      if (action === 'first') {
        page = 1;
      } else if (action === 'last') {
        page = totalPages;
      } else if (action === 'prev') {
        page = Math.max(1, page);
      } else if (action === 'next') {
        page = Math.min(totalPages, page);
      }

      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const paginatedInventory = processedInventory.slice(startIndex, endIndex);

      let inventoryList = '';
      if (paginatedInventory.length > 0) {
        inventoryList = paginatedInventory.map((item, index) => {
          let display = '';
          const itemNumber = startIndex + index + 1;

          if (item.type === 'harvested_plant') {
            const mutationsText = item.mutations && item.mutations.length
              ? item.mutations.map(m => formatNameForDisplay(m.name)).join(' ') + ' '
              : '';
            const weightText = item.weight ? `(${item.weight.toFixed(2)}kg)` : '';
            const specialCodeText = item.specialCode ? ` [${item.specialCode}]` : '';
            const favouriteIcon = item.favourite ? '⭐ ' : '';
            display = `${favouriteIcon}${getEmoji('harvested_plant', item.name, 4, item.mutations)} ${mutationsText}${formatNameForDisplay(item.name)}${weightText}${specialCodeText}`;
          } else if (item.type === 'pet_egg') {
            const eggRarity = eggData[item.name]?.rarity || 'Unknown';
            display = `${getEmoji('pet_egg')} ${eggRarity} Egg`;
          } else if (item.type === 'pet') {
            const favouriteIcon = item.favourite ? '⭐ ' : '';
            display = `${favouriteIcon}${getEmoji('pet', item.name)} ${formatNameForDisplay(item.name)} (Age: ${item.age || 0})`;
          } else if (item.type === 'seed') {
            display = `${getEmoji('seed', item.name, 0)} ${formatNameForDisplay(item.name)} Seed x${item.quantity}`;
          }
          return `${itemNumber}. ${display}`;
        }).join('\n');
      } else {
        inventoryList = 'Empty';
      }

      const embed = new EmbedBuilder()
        .setTitle('🎒 Your Inventory 🎒')
        .setColor('#00ff00')
        .addFields(
          { name: '💰 Balance', value: `${user.balance} Sheckles`, inline: true },
          { name: `Items (Page ${page}/${totalPages})`, value: inventoryList || 'Empty', inline: false }
        );

      const paginationRow = new ActionRowBuilder();
      paginationRow.addComponents(
        new ButtonBuilder()
          .setCustomId('inv_first_page')
          .setLabel('⏪ First')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`inv_prev_page_${page - 1}`)
          .setLabel('◀️ Back')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`inv_next_page_${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages || totalPages === 0),
        new ButtonBuilder()
          .setCustomId('inv_last_page')
          .setLabel('⏩ Last')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages || totalPages === 0)
      );

      await interaction.message.edit({ embeds: [embed], components: [paginationRow] }).catch(e => console.error("Error updating inventory message:", e));
      await interaction.editReply({ content: 'Inventory updated.', ephemeral: true });
    } else if (interaction.customId.startsWith('info_')) {
      const slot = parseInt(interaction.customId.replace('info_', '')) - 1;
      if (slot < 0 || slot > 8 || !user.garden[slot]) {
        await interaction.editReply('Invalid or empty slot!');
        return;
      }
      const plant = user.garden[slot];
      const price = getSellPrice(plant.name, plant.level, plant.mutations, plant.weight);
      const levelDisplay = plant.level === 4 ? 'Max' : plant.level;
      const embed = new EmbedBuilder()
        .setTitle(`🌱 Slot ${slot + 1} Info`)
        .setColor('#00ff00')
        .addFields(
          { name: 'Plant', value: `${formatNameForDisplay(plant.name)} (Lvl ${levelDisplay})`, inline: true },
          { name: 'Size', value: `${plant.weight.toFixed(2)}kg`, inline: true },
          { name: 'Mutations', value: plant.mutations.length ? plant.mutations.map(m => formatNameForDisplay(m.name)).join(', ') : 'None', inline: true },
          { name: 'Sell Price', value: `${price.toFixed(2)} Sheckles`, inline: true } // Format sell price
        )
        .setFooter({ text: 'Harvest when fully grown (Lvl Max) for max value!' });
      await interaction.editReply({ embeds: [embed] });
    } else if (interaction.customId === 'refresh_garden') {
        // Re-run the garden command logic to refresh the display
        const now = Date.now();
        // Set active_garden_until to now + 5 minutes to reactivate the window
        const newActiveUntil = new Date(now + 5 * 60 * 1000).toISOString();

        // Fetch the latest user data to apply updates correctly before display
        const { data: latestUserBeforeDisplay, error: latestUserBeforeDisplayError } = await supabase
            .from('users')
            .select('*')
            .eq('user_id', interaction.user.id)
            .single();

        if (latestUserBeforeDisplayError || !latestUserBeforeDisplay) {
            console.error(`Failed to fetch latest user data for /garden refresh:`, latestUserBeforeDisplayError);
            await interaction.editReply({ content: 'Failed to refresh garden. Please try again later.', ephemeral: true });
            return;
        }

        let updatedGarden = [...latestUserBeforeDisplay.garden];
        let gardenUpdatedForUser = false;
        const lastCalcTime = latestUserBeforeDisplay.last_growth_calculation_time ? new Date(latestUserBeforeDisplay.last_growth_calculation_time).getTime() : now;
        const timeSinceLastCalc = now - lastCalcTime;
        const currentWeather = await updateWeather();

        for (let i = 0; i < updatedGarden.length; i++) {
            if (updatedGarden[i] && updatedGarden[i].plantedAt) {
                updatedGarden[i].totalGrowthTimeAccumulated = (updatedGarden[i].totalGrowthTimeAccumulated || 0) + timeSinceLastCalc;

                const plantData = plants[updatedGarden[i].name];
                const baseGrowthTime = plantData.growthTime / 4;
                let adjustedGrowthTime = baseGrowthTime;
                // Apply growth boost only if garden is active
                if (new Date(newActiveUntil).getTime() > now && currentWeather && weatherData[currentWeather]?.growthBoost) {
                    adjustedGrowthTime /= (1 + weatherData[currentWeather].growthBoost);
                }

                const level = Math.min(
                    4,
                    Math.floor(updatedGarden[i].totalGrowthTimeAccumulated / (adjustedGrowthTime * 1000))
                );

                if (updatedGarden[i].level !== level) {
                    updatedGarden[i].level = level;
                    gardenUpdatedForUser = true;
                }
                // Apply mutations immediately on refresh, as the garden is now active
                if (new Date(newActiveUntil).getTime() > now) {
                  updatedGarden[i].mutations = applyMutations(updatedGarden[i].name, updatedGarden[i], latestUserBeforeDisplay, currentWeather);
                } else {
                  updatedGarden[i].mutations = updatedGarden[i].mutations || [];
                }
                const seed = `${latestUserBeforeDisplay.user_id}_${i}_${updatedGarden[i].plantedAt}`;
                [updatedGarden[i].weight] = calculateWeight(seed, updatedGarden[i].name);
                gardenUpdatedForUser = true;
            }
        }

        await supabase
            .from('users')
            .update({ 
                garden: updatedGarden, 
                last_growth_calculation_time: now, 
                active_garden_until: newActiveUntil 
            })
            .eq('user_id', interaction.user.id);

        const { data: latestUserForDisplay, error: latestUserForDisplayError } = await supabase
            .from('users')
            .select('*')
            .eq('user_id', interaction.user.id)
            .single();

        if (latestUserForDisplayError || !latestUserForDisplay) {
            console.error(`Failed to fetch latest user data for garden display refresh:`, latestUserForDisplayError);
            await interaction.editReply({ content: 'Failed to refresh garden. Please try again later.', ephemeral: true });
            return;
        }

        const { content, components } = await getGardenDisplayContent(latestUserForDisplay, currentWeather);
        try {
            await interaction.message.edit({ content, components });
            await interaction.editReply({ content: 'Garden refreshed!', ephemeral: true });
        } catch (editError) {
            console.error("Error editing Discord message on refresh:", editError);
            await interaction.editReply({ content: 'Failed to refresh garden display. The message might be too old or deleted.', ephemeral: true });
        }
    }
  } else if (interaction.isStringSelectMenu()) {
      // String select menu interactions for tracker command are public
      await interaction.deferReply();
      const userId = interaction.user.id;
      const customIdParts = interaction.customId.split('_');
      const category = customIdParts[2]; // e.g., 'plant', 'egg', 'weather'
      const selectedRoleIds = interaction.values; // Array of selected role IDs

      const member = interaction.member; // Get the GuildMember object

      if (!member) {
          await interaction.editReply('Could not find your member data in this server. Please try again in a server channel.');
          return;
      }

      // Fetch current user preferences from Supabase
      const { data: userPrefs, error: prefsError } = await supabase
          .from('user_tracking_preferences')
          .select('tracked_role_ids')
          .eq('user_id', userId)
          .single();

      if (prefsError && prefsError.code !== 'PGRST116') { // PGRST116 means no rows found
          console.error("Error fetching user tracking preferences:", prefsError);
          await interaction.editReply('Failed to update tracking preferences. Please try again.');
          return;
      }

      const currentlyTrackedRoleIdsInDb = userPrefs?.tracked_role_ids || [];

      // Fetch all role mappings for the current category from Supabase
      const { data: allCategoryRoleMaps, error: allCategoryRoleMapsError } = await supabase
          .from('discord_roles_map')
          .select('role_id, type')
          .eq('type', category);
      
      if (allCategoryRoleMapsError) {
          console.error("Error fetching all category role maps:", allCategoryRoleMapsError);
          await interaction.editReply('Failed to update tracking preferences due to role data error.');
          return;
      }

      const allRoleIdsInCurrentCategory = allCategoryRoleMaps.map(role => role.role_id);

      const rolesToAdd = selectedRoleIds.filter(roleId => !member.roles.cache.has(roleId));
      const rolesToRemove = allRoleIdsInCurrentCategory.filter(roleId => 
          member.roles.cache.has(roleId) && !selectedRoleIds.includes(roleId)
      );

      let rolesUpdated = false;

      // Add roles
      if (rolesToAdd.length > 0) {
          try {
              await member.roles.add(rolesToAdd, 'User opted in for notifications via tracker command.');
              rolesUpdated = true;
          } catch (e) {
              console.error(`Error adding roles to user ${userId}:`, e);
              await interaction.editReply(`Failed to add some roles. Please ensure the bot has 'Manage Roles' permission. Error: ${e.message}`);
              return;
          }
      }

      // Remove roles
      if (rolesToRemove.length > 0) {
          try {
              await member.roles.remove(rolesToRemove, 'User opted out of notifications via tracker command.');
              rolesUpdated = true;
          } catch (e) {
              console.error(`Error removing roles from user ${userId}:`, e);
              await interaction.editReply(`Failed to remove some roles. Error: ${e.message}`);
              return;
          }
      }

      // Update Supabase with the new set of tracked roles
      const newTrackedRoleIdsForDb = currentlyTrackedRoleIdsInDb.filter(roleId => 
          !allRoleIdsInCurrentCategory.includes(roleId) // Keep roles from other categories
      ).concat(selectedRoleIds); // Add newly selected roles for this category

      const { error: updateDbError } = await supabase
          .from('user_tracking_preferences')
          .upsert({ user_id: userId, tracked_role_ids: newTrackedRoleIdsForDb }, { onConflict: 'user_id' });

      if (updateDbError) {
          console.error("Error updating user tracking preferences in DB:", updateDbError);
          await interaction.editReply('Failed to update tracking preferences in the database. Please try again.');
      } else {
          if (rolesUpdated) {
            await interaction.editReply(`Your tracking preferences for **${formatNameForDisplay(category)}** have been updated on Discord and in the database!`);
          } else {
            await interaction.editReply(`Your tracking preferences for **${formatNameForDisplay(category)}** are already up to date.`);
          }
      }
  }
});

client.login(process.env.DISCORD_TOKEN);
