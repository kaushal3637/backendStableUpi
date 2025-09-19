import 'dotenv/config';
import axios from 'axios';

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const apiKey = process.env.API_KEY || 'your_development_api_key_here';

  const chainId = Number(process.env.TEST_CHAIN_ID || 421614);
  const to = process.env.TEST_REFUND_TO || '0x1234567890123456789012345678901234567890';
  const amount = process.env.TEST_REFUND_AMOUNT || '1.000000';
  const from = process.env.TEST_REFUND_FROM || '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const txHash = process.env.TEST_REFUND_TXHASH || '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const networkFee = process.env.TEST_REFUND_NETWORK_FEE || '0.001000';
  const totalPaid = process.env.TEST_REFUND_TOTAL_PAID || '1.001000';
  const reason = process.env.TEST_REFUND_REASON || 'script_refund_test';

  console.log('Triggering refund...');
  console.log({ baseUrl, chainId, to, amount, from, txHash, networkFee, totalPaid, reason });

  try {
    const res = await axios.post(
      `${baseUrl}/api/payments/refund`,
      { chainId, to, amount, from, txHash, networkFee, totalPaid, reason },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      }
    );

    console.log('Refund response:', res.data);
    process.exit(0);
  } catch (err: any) {
    if (err.response) {
      console.error('Refund failed:', err.response.status, err.response.data);
    } else {
      console.error('Refund error:', err.message);
    }
    process.exit(1);
  }
}

main();


