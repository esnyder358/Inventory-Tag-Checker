export default async function handler(req, res) {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiKey = process.env.SHOPIFY_ADMIN_API_KEY;
  const password = process.env.SHOPIFY_ADMIN_API_PASSWORD;
  const tagsToCheck = process.env.TAGS_TO_CHECK?.split(',').map(tag => tag.trim());
  const emailTo = process.env.EMAIL_TO;
  const emailFrom = process.env.EMAIL_FROM;
  const postmarkApiKey = process.env.POSTMARK_API_KEY;

  if (!storeDomain || !apiKey || !password || !tagsToCheck || !emailTo || !emailFrom || !postmarkApiKey) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const basicAuth = Buffer.from(`${apiKey}:${password}`).toString('base64');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${basicAuth}`
  };

  const missingTagProductIds = [];
  let pageInfo = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const queryParams = pageInfo ? `?page_info=${pageInfo}&limit=250` : `?limit=250`;
    const response = await fetch(`https://${storeDomain}/admin/api/2023-10/products.json${queryParams}`, {
      headers
    });

    const data = await response.json();
    if (!data.products) break;

    for (const product of data.products) {
      const productTags = product.tags.split(',').map(tag => tag.trim().toLowerCase());
      const hasAnyTag = tagsToCheck.some(requiredTag => productTags.includes(requiredTag.toLowerCase()));
      if (!hasAnyTag) {
        missingTagProductIds.push(product.id);
      }
    }

    const linkHeader = response.headers.get('link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^&>]+)/);
      pageInfo = match ? match[1] : null;
    } else {
      hasNextPage = false;
    }
  }

  if (missingTagProductIds.length === 0) {
    return res.status(200).json({ message: 'All products have at least one required tag.' });
  }

  // Send report with Postmark
  const emailBody = `Products missing at least one of the following tags: ${tagsToCheck.join(', ')}\n\n` +
    missingTagProductIds.map(id => `Product ID: ${id}`).join('\n');

  const emailResponse = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'X-Postmark-Server-Token': postmarkApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      From: emailFrom,
      To: emailTo,
      Subject: 'Shopify Products Missing Required Tags',
      TextBody: emailBody
    })
  });

  if (!emailResponse.ok) {
    return res.status(500).json({ error: 'Failed to send email' });
  }

  return res.status(200).json({ message: 'Email sent successfully', productIds: missingTagProductIds });
}
