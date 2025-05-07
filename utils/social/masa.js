import { sleep } from "../utils";

const MASA_BASE_URL = "https://data.dev.masalabs.ai/api/v1";
const MASA_API_KEY = process.env.MASA_API_KEY;

const POLLING_INTERVAL = 10000; // 10 seconds for job status polling
const MAX_POLLS = 30; // Max 30 polls (5 minutes)

if (!MASA_API_KEY) {
  console.warn(
    "MASA_API_KEY environment variable is not set. Masa API calls will fail."
  );
}

/**
 * Submits a search job to the Masa API.
 * @param {string} query - The search query.
 * @param {number} [max_results=100] - Maximum number of results to return.
 * @returns {Promise<string|null>} - The UUID of the search job, or null on error.
 */
export const submitMasaSearchJob = async (query, max_results = 100) => {
  if (!MASA_API_KEY) throw new Error("Masa API key not configured.");
  const url = `${MASA_BASE_URL}/search/live/twitter`;
  const payload = {
    query,
    max_results,
  };
  console.log(
    `Submitting Masa search job with query: "${query}", max_results: ${max_results}`
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MASA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Error submitting Masa search job: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(`Masa API error: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    if (data.error) {
      console.error(
        "Masa API returned an error on job submission:",
        data.error
      );
      return null;
    }
    console.log("Masa search job submitted, UUID:", data.uuid);
    return data.uuid;
  } catch (error) {
    console.error("Failed to submit Masa search job:", error);
    return null;
  }
};

/**
 * Checks the status of a Masa search job.
 * @param {string} uuid - The UUID of the search job.
 * @returns {Promise<string|null>} - The status of the job ('processing', 'done', 'error', 'error(retrying)'), or null on error.
 */
export const checkMasaJobStatus = async (uuid) => {
  if (!MASA_API_KEY) throw new Error("Masa API key not configured.");
  const url = `${MASA_BASE_URL}/search/live/twitter/status/${uuid}`;
  console.log("Checking Masa job status for UUID:", uuid);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MASA_API_KEY}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Error checking Masa job status: ${response.status} ${response.statusText}`,
        errorText
      );
      // It might be a temporary issue, so don't immediately null out, let polling retry
      return "error(fetching_status)";
    }
    const data = await response.json();
    if (
      data.error &&
      data.status !== "error" &&
      data.status !== "error(retrying)"
    ) {
      // If there's an error message but status isn't an error status, log it but trust status
      console.warn(
        "Masa API returned an error message with non-error status:",
        data.error
      );
    }
    console.log(`Masa job status for ${uuid}: ${data.status}`);
    return data.status;
  } catch (error) {
    console.error("Failed to check Masa job status:", error);
    return "error(fetching_status)"; // Indicate a client-side error during fetch
  }
};

/**
 * Retrieves the results of a completed Masa search job.
 * @param {string} uuid - The UUID of the search job.
 * @returns {Promise<Array<object>|null>} - An array of tweet objects, or null on error or if job not done.
 */
export const getMasaJobResults = async (uuid) => {
  if (!MASA_API_KEY) throw new Error("Masa API key not configured.");
  const url = `${MASA_BASE_URL}/search/live/twitter/result/${uuid}`;
  console.log("Retrieving Masa job results for UUID:", uuid);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MASA_API_KEY}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Error retrieving Masa job results: ${response.status} ${response.statusText}`,
        errorText
      );
      return null;
    }
    const data = await response.json();
    // The response is directly an array of results if successful
    console.log(`Retrieved ${data?.length || 0} results for Masa job ${uuid}`);
    return data;
  } catch (error) {
    console.error("Failed to retrieve Masa job results:", error);
    return null;
  }
};

/**
 * Full workflow: Submits a job, polls for completion, and returns results.
 * @param {string} query - The search query.
 * @param {number} [max_results=100] - Maximum number of results.
 * @returns {Promise<Array<object>|null>} - An array of tweet objects, or null on error.
 */
export const searchTweetsWithMasa = async (query, max_results = 100) => {
  const uuid = await submitMasaSearchJob(query, max_results);
  if (!uuid) {
    return null;
  }

  let polls = 0;
  while (polls < MAX_POLLS) {
    await sleep(POLLING_INTERVAL);
    const status = await checkMasaJobStatus(uuid);

    if (status === "done") {
      return getMasaJobResults(uuid);
    }
    if (
      status === "error" ||
      status === null ||
      status === "error(fetching_status)"
    ) {
      console.error(`Masa job ${uuid} failed or status check error.`);
      return null;
    }
    // For 'processing' or 'error(retrying)', continue polling.
    polls++;
  }

  console.error(`Masa job ${uuid} timed out after ${MAX_POLLS} polls.`);
  return null;
};
