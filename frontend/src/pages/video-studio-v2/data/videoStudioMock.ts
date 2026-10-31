
export type WorkflowStage = "brief" | "intelligence" | "creative" | "create" | "review" | "learn";
export type ThemeMode = "light" | "dark";

export const workflow = [
  { id: "brief" as WorkflowStage, number: 1, label: "BRIEF" },
  { id: "intelligence" as WorkflowStage, number: 2, label: "INTELLIGENCE" },
  { id: "creative" as WorkflowStage, number: 3, label: "CREATIVE LAB" },
  { id: "create" as WorkflowStage, number: 4, label: "CREATE / EDIT" },
  { id: "review" as WorkflowStage, number: 5, label: "REVIEW" },
  { id: "learn" as WorkflowStage, number: 6, label: "LEARN" },
];

export const hookIdeas = [
  { text: "People see your shop. So why aren’t they walking in?", score: 86, type: "Question", goal: "Awareness", tone: "Direct" },
  { text: "Why does your showroom look good but footfall stay low?", score: 82, type: "Question", goal: "Awareness", tone: "Direct" },
  { text: "You’re visible. So why aren’t the right builders choosing you?", score: 80, type: "Question", goal: "Traffic", tone: "Direct" },
  { text: "What is your showroom telling builders about you?", score: 78, type: "Question", goal: "Awareness", tone: "Curious" },
  { text: "The problem isn’t your tiles. It’s your positioning.", score: 76, type: "Statement", goal: "Leads", tone: "Bold" },
  { text: "Most tile shops make this same costly mistake.", score: 74, type: "Statement", goal: "Awareness", tone: "Bold" },
  { text: "Imagine your ideal builder walks into your showroom...", score: 72, type: "Scenario", goal: "Leads", tone: "Curious" },
  { text: "Builders don't need more choice. They need more certainty.", score: 70, type: "Statement", goal: "Traffic", tone: "Direct" },
  { text: "Your stock is ready. Is your positioning?", score: 68, type: "Question", goal: "Awareness", tone: "Curious" },
  { text: "Stop competing on price. Start competing on reliability.", score: 66, type: "Statement", goal: "Leads", tone: "Bold" },
];

export const mediaItems = [
  "tiles_showroom.jpg",
  "builder_site.jpg",
  "stock_tiles.jpg",
  "showroom_walk.mp4",
  "delivery_truck.mp4",
  "worker_cutting.mp4",
  "tiles_closeup.jpg",
  "team_discussion.jpg",
];

export const reviewCriteria = [
  ["Hook Strength", 9],
  ["Message Clarity", 9],
  ["Audience Relevance", 9],
  ["Brand Consistency", 10],
  ["Visual Storytelling", 9],
  ["Pacing & Flow", 9],
  ["CTA Effectiveness", 9],
  ["Platform Fit", 9],
  ["Shareability Potential", 9],
  ["SEO / Captions / Keywords", 8],
] as const;

export const analyticsRows = [
  ["Why builders choose us every time", "Instagram", "25.4K", "8.2s", "55%", "1.8K", "320", "2.3%"],
  ["Stop losing builders to your competitors", "TikTok", "18.7K", "6.1s", "49%", "1.2K", "210", "1.8%"],
  ["Stock. Service. Solutions.", "Facebook", "45.1K", "9.3s", "62%", "2.9K", "612", "3.6%"],
  ["That trade problem may have nothing to do with price", "YouTube", "32.8K", "10.4s", "58%", "2.1K", "410", "2.9%"],
  ["Why positioning impacts every tile sale", "LinkedIn", "6.3K", "12.7s", "65%", "430", "110", "4.1%"],
] as const;
