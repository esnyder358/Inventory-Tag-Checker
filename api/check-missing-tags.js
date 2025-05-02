export const config = {
  schedule: '0 7 * * 5' // Every Friday at 7 AM
};
const fetch = require('node-fetch');
const postmark = require('postmark');

module.exports = async (req, res) => {
  try {
    const {
      SHOPIFY_STORE_DOMAIN,
      SHOPIFY_ADMIN_API_KEY,
      SHOPIFY_ADMIN_API_PASSWORD,
      TAGS_TO_CHECK,
      POSTMARK_API_KEY,
      EMAIL_TO,
      EMAIL_FROM
    } = process.env;

    console.log("🔧 ENV loaded:", {
      SHOPIFY_STORE_DOMAIN,
      TAGS_TO_CHECK,
      EMAIL_TO,
      EMAIL_FROM
    });

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_KEY || !SHOPIFY_ADMIN_API_PASSWORD) {
      throw new Error("Missing Shopify credentials in environment.");
    }

    const tagsToCheck = TAGS_TO_CHECK.split(',').map(t => t.trim().toLowerCase());
    const missingTagProductIds = [];
    let products = [];
    let pageInfo = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products.json?limit=250${pageInfo ? `&page_info=${pageInfo}` : ''}`;
      const response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_PASSWORD,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Shopify API error:", errorText);
        throw new Error("Shopify API request failed.");
      }

      const data = await response.json();
      products = data.products || [];
      console.log(`📦 Fetched ${products.length} products`);

      for (const product of products) {
        const productTags = product.tags.toLowerCase().split(',').map(t => t.trim());
        const hasRequiredTag = tagsToCheck.some(tag => productTags.includes(tag));
        if (!hasRequiredTag) {
          missingTagProductIds.push(product.id);
        }
      }

      // Shopify REST pagination (simplified assumption for now)
      hasNextPage = false;
    }

    console.log("🚨 Missing tag product IDs:", missingTagProductIds);

    if (missingTagProductIds.length > 0) {
      const client = new postmark.ServerClient(POSTMARK_API_KEY);
      const sendResult = await client.sendEmail({
        From: EMAIL_FROM,
        To: EMAIL_TO,
        Subject: "Missing Tags Report",
        TextBody: `Products missing required tags:\n\n${missingTagProductIds.join('\n')}`
      });
      console.log("📧 Email sent:", sendResult);
    }

    res.status(200).json({
      message: "Check complete.",
      missing: missingTagProductIds
    });

  } catch (err) {
    console.error("💥 Error occurred:", err);
    res.status(500).json({ error: err.message });
  }
};
