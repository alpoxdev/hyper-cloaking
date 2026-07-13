/** Summarize bounded Coupang product records for comparison and ranking. */
function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

/**
 * Analyze up to 100 products, returning aggregate metrics, category counts,
 * and the highest-reviewed and highest-rated records.
 */
export function analyzeProducts(records) {
  const products = Array.isArray(records) ? records.slice(0, 100) : [];
  const categories = new Map();
  for (const product of products) {
    const category = String(product?.category ?? '')
      .trim()
      .toLowerCase();
    if (category) categories.set(category, (categories.get(category) || 0) + 1);
  }
  const topReviewed =
    [...products]
      .filter((product) => finite(product?.reviewCount) !== null)
      .sort((left, right) => finite(right.reviewCount) - finite(left.reviewCount))[0] || null;
  const topRated =
    [...products]
      .filter((product) => finite(product?.rating) !== null)
      .sort((left, right) => finite(right.rating) - finite(left.rating))[0] || null;
  return {
    count: products.length,
    averagePrice: average(products.map((product) => product?.price)),
    averageRating: average(products.map((product) => product?.rating)),
    topReviewed,
    topRated,
    categories: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort(
        (left, right) => right.count - left.count || left.category.localeCompare(right.category)
      )
  };
}
