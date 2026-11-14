import type { Fixture } from "./schemas.ts";

type Review = Fixture["reviews"][number];

export type ReviewTheme = {
  key: string;
  label: string;
  count: number;
  fraction: number;
  reviewIds: string[];
};

export function themeKey(theme: string) {
  return theme.trim().toLocaleLowerCase("en-US");
}

export function summarizeReviews(reviews: readonly Review[]) {
  const themes = new Map<string, { label: string; reviewIds: string[] }>();
  const ratingCounts = new Map<number, number>();

  for (const review of reviews) {
    ratingCounts.set(review.rating, (ratingCounts.get(review.rating) ?? 0) + 1);
    const countedThemes = new Set<string>();
    for (const theme of review.themes) {
      const key = themeKey(theme);
      if (!key || countedThemes.has(key)) continue;
      countedThemes.add(key);
      const existing = themes.get(key);
      if (existing) existing.reviewIds.push(review.id);
      else themes.set(key, { label: theme.trim(), reviewIds: [review.id] });
    }
  }

  const total = reviews.length;
  const topics: ReviewTheme[] = Array.from(themes, ([key, value]) => ({
    key,
    label: value.label,
    count: value.reviewIds.length,
    fraction: total ? value.reviewIds.length / total : 0,
    reviewIds: value.reviewIds,
  })).sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, "en-US"));

  return {
    total,
    meanRating: total ? reviews.reduce((sum, review) => sum + review.rating, 0) / total : null,
    themes: topics,
    ratings: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: ratingCounts.get(rating) ?? 0,
      fraction: total ? (ratingCounts.get(rating) ?? 0) / total : 0,
    })),
  };
}

export function filterReviews(
  reviews: readonly Review[],
  options: { query?: string; theme?: string; citedOnly?: boolean; evidenceIds?: readonly string[] } = {},
) {
  const query = options.query?.trim().toLocaleLowerCase("en-US") ?? "";
  const theme = themeKey(options.theme ?? "");
  const evidenceIds = new Set(options.evidenceIds ?? []);

  return reviews.filter((review) => {
    if (options.citedOnly && !evidenceIds.has(review.id)) return false;
    if (theme && !review.themes.some((item) => themeKey(item) === theme)) return false;
    const searchable = [review.text, review.id, ...review.themes].join(" ").toLocaleLowerCase("en-US");
    return !query || searchable.includes(query);
  });
}
