import * as fs from "fs";

import * as dotenv from "dotenv";
dotenv.config();
import { marked } from "marked";
import { SimplePool, nip19, nip04 } from "nostr-tools";
import "websocket-polyfill";

// ReferenceError: crypto is not defined (not in browser) · Issue #192 · nbd-wtf/nostr-tools
// https://github.com/nbd-wtf/nostr-tools/issues/192#issuecomment-1557401767
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// 投稿者の公開鍵 (16 進数)
const PK = "0a2f19dc1a185792c3b0376f1d7f9971295e8932966c397935a5dddd1451a25a";

// リレー サーバー
const RELAYS = JSON.parse(process.env.RELAYS.replace(/'/g, '"'));

// 復号化するための秘密鍵 (16 進数)
const DECRYPTION_SK = process.env.DECRYPTION_SK;

const _renderContent = (content) =>
  marked.parse(
    content
      .replace(
        /(https?:\/\/\S+\.(jpg|jpeg|png|webp|avif|gif))/g,
        '<a href="$1"><img src="$1" loading="lazy"></a>'
      )
      .replace(
        /NIP-(\d{2})/g,
        '<a href="https://github.com/nostr-protocol/nips/blob/master/$1.md">$&</a>'
      )
      .replace(/^#+ /g, "\\$&")
  );

const fetchPosts = async (relay, until, olderPost) => {
  const posts = (
    await pool.list(
      [relay],
      [
        {
          authors: [PK],
          kinds: [1],
          until,
          limit: 200,
        },
      ]
    )
  )
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 200);
  const oldestPost = posts[posts.length - 1];
  return [
    ...(oldestPost && oldestPost.id !== olderPost?.id
      ? await fetchPosts(relay, oldestPost.created_at, oldestPost)
      : []),
    ...posts,
  ];
};

const generateHashtagHtml = (posts) => {
  // 日時の降順にソートして、タグごとにグループ化する
  const sortedPosts = [...posts].sort((a, b) => b.created_at - a.created_at);
  const groupedPosts = sortedPosts.reduce((acc1, obj1) => {
    const tags = (
      obj1.content.match(
        /(^|\s)#[a-z0-9\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]+/gi
      ) ?? []
    ).filter((tag) => !/#\d+/.test(tag));
    return tags.reduce((acc2, obj2) => {
      const tag = obj2.trim();
      const key =
        Object.keys(acc2).find(
          (key) => key.toLowerCase() == tag.toLowerCase()
        ) ?? tag;
      const curGroup = acc2[key] ?? [];
      return { ...acc2, [key]: [...curGroup, obj1] };
    }, acc1);
  }, {});

  // HTML を作成する
  return generateHtml(
    Object.keys(groupedPosts)
      .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
      .map(
        (tag) =>
          `      <h2 id="${tag.substring(1)}">${tag}</h2>
` +
          groupedPosts[tag]
            .map((post) => {
              const date = new Date(post.created_at * 1000);
              const dateTime = date.toLocaleString();
              const content = _renderContent(post.content);
              return `      <h3><a href="https://njump.me/${nip19.neventEncode({
                id: post.id,
              })}">${dateTime}</a></h3>
      ${content}`;
            })
            .join("\n")
      )
      .join("\n")
  );
};

const generateHtml = (content) =>
  `<!DOCTYPE html>
  <html lang="ja">
    <head>
      <meta charset="utf8" />
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="github-markdown.css">
      <style>
        .markdown-body {
          box-sizing: border-box;
          min-width: 200px;
          max-width: 980px;
          margin: 0 auto;
          padding: 45px;
        }
      
        @media (max-width: 767px) {
          .markdown-body {
            padding: 15px;
          }
        }

        img {
          max-width: 600px;
        }

        @media screen and (max-width: 600px) {
          img {
            max-width: 100%;
          }
        }
      </style>
      <title>メモ</title>
    </head>
    <body class="markdown-body">
      <h1>メモ</h1>
` +
  content +
  `
    </body>
  </html>`;

const generateIndexHtml = (posts) => {
  // 日時の降順にソートして、日ごとにグループ化する
  const sortedPosts = [...posts].sort((a, b) => b.created_at - a.created_at);
  const groupedPosts = sortedPosts.reduce((acc, obj) => {
    const date = new Date(obj.created_at * 1000);
    const key = date.toLocaleDateString();
    const curGroup = acc[key] ?? [];
    return { ...acc, [key]: [...curGroup, obj] };
  }, {});

  // HTML を作成する
  return generateHtml(
    Object.keys(groupedPosts)
      .map(
        (postDay) =>
          `      <h2>${postDay}</h2>
` +
          groupedPosts[postDay]
            .map((post) => {
              const date = new Date(post.created_at * 1000);
              const time = date.toLocaleTimeString();
              const content = _renderContent(post.content);
              return `      <h3><a href="https://njump.me/${nip19.neventEncode({
                id: post.id,
              })}">${time}</a></h3>
      ${content}`;
            })
            .join("\n")
      )
      .join("\n")
  );
};

marked.setOptions({
  breaks: true,
});

// HACK: nostr-tools のタイムアウトを長くする
const temp = setTimeout;
setTimeout = (func) => temp(func, 3 * 60 * 1000);

// 投稿を取得する
const pool = new SimplePool();
const posts = await Promise.all(
  [
    ...new Map(
      (await Promise.all(RELAYS.map(async (relay) => await fetchPosts(relay))))
        .flat()
        .map((obj) => [obj.id, obj])
    ).values(),
  ].map(async (post) =>
    post.tags.find((tag) => tag[0] == "encrypted")
      ? {
          ...post,
          content: await nip04.decrypt(DECRYPTION_SK, PK, post.content),
        }
      : post
  )
);

// ファイルに出力する
fs.writeFileSync("index.html", generateIndexHtml(posts));
fs.writeFileSync("hashtag.html", generateHashtagHtml(posts));

// await pool.close(RELAYS); // TypeError: Cannot read properties of undefined (reading 'sendCloseFrame')
process.exit(); // HACK: 強制終了する
