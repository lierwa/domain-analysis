import { beforeEach, describe, expect, it, vi } from "vitest";
import got from "got";
import { createRedditPublicJsonAdapter } from "./reddit";

const gotMock = vi.hoisted(() => vi.fn());

vi.mock("got", () => ({
  default: gotMock
}));

const query = {
  name: "tattoo",
  includeKeywords: ["tattoo styles"],
  excludeKeywords: [],
  language: "en",
  limitPerRun: 10
};

const redditBody = JSON.stringify({
  data: {
    children: [
      {
        data: {
          id: "post_1",
          name: "t3_post_1",
          title: "Tattoo styles inspiration",
          selftext: "Fine line ideas",
          permalink: "/r/tattoo/comments/post_1",
          author: "artist",
          subreddit: "tattoo",
          score: 12,
          num_comments: 3,
          created_utc: 1710000000
        }
      }
    ]
  }
});

beforeEach(() => {
  gotMock.mockReset();
  gotMock.mockResolvedValue({ statusCode: 200, body: redditBody });
});

describe("createRedditPublicJsonAdapter", () => {
  it("passes configured proxy URLs into got's HTTPS agent", async () => {
    const adapter = createRedditPublicJsonAdapter({ https_proxy: "http://127.0.0.1:7890" });

    await expect(adapter.collect(query)).resolves.toHaveLength(1);

    expect(got).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      agent: expect.objectContaining({ https: expect.any(Object) })
    }));
  });

  it("keeps direct Reddit collection when no proxy is configured", async () => {
    const adapter = createRedditPublicJsonAdapter({});

    await expect(adapter.collect(query)).resolves.toHaveLength(1);

    expect(got).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      agent: undefined
    }));
  });

  it("maps Reddit public blocking status to a clear rate-limit error", async () => {
    gotMock.mockResolvedValueOnce({ statusCode: 403, body: "" });
    const adapter = createRedditPublicJsonAdapter({ https_proxy: "http://127.0.0.1:7890" });

    await expect(adapter.collect(query)).rejects.toThrow("reddit_public_rate_limited_403");
  });
});
