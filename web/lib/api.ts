const API_BASE = 'http://127.0.0.1:8001/api';

export async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'no-store', // Always fetch fresh data for dashboard
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} on ${endpoint}`);
  }

  return response.json();
}

export async function getDashboardOverview() {
  const data = await fetchAPI('/dashboard/overview');
  return data.data;
}

export async function getDashboardActivity() {
  const data = await fetchAPI('/dashboard/activity');
  return data.data;
}

export async function getIntents() {
  const data = await fetchAPI('/intents');
  return data.data;
}

export async function getIntentDetail(intentId: string) {
  const data = await fetchAPI(`/intents/${intentId}`);
  return data.data;
}

export async function getPayments() {
  const data = await fetchAPI('/payments');
  return data.data;
}

export async function getPaymentDetail(paymentId: string) {
  const data = await fetchAPI(`/payments/${paymentId}`);
  return data.data;
}

export async function getRefunds() {
  const data = await fetchAPI('/refunds');
  return data.data;
}

export async function getRefundDetail(refundId: string) {
  const data = await fetchAPI(`/refunds/${refundId}`);
  return data.data;
}

export async function getObligations() {
  const data = await fetchAPI('/obligations');
  return data.data;
}

export async function getApprovals() {
  const data = await fetchAPI('/approvals');
  return data.data;
}

export async function getReconciliations() {
  const data = await fetchAPI('/reconciliations');
  return data.data;
}

export async function getAgents() {
  const data = await fetchAPI('/agents');
  return data.data;
}

export async function getAgentDetail(agentId: string) {
  const data = await fetchAPI(`/agents/${agentId}`);
  return data.data;
}

export async function submitIntent(payload: any) {
  const data = await fetchAPI('/gate/intent', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.data;
}

export async function getProofs() {
  const data = await fetchAPI('/proofs');
  return data.data;
}
