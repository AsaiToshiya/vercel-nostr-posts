import * as fs from "fs";

import * as dotenv from "dotenv";
dotenv.config();
import { marked } from "marked";
import pkg from "nostr-tools";
const { SimplePool } = pkg;
import "websocket-polyfill";

// 投稿者の公開鍵 (16 進数)
const PK = "0a2f19dc1a185792c3b0376f1d7f9971295e8932966c397935a5dddd1451a25a";

// リレー サーバー
const RELAYS = JSON.parse(process.env.RELAYS.replace(/'/g, '"'));

// HACK: nostr-tools のタイムアウトを長くする
const temp = setTimeout;
setTimeout = (func) => temp(func, 30 * 1000);

// 投稿を取得する
const pool = new SimplePool();
const posts = await pool.list(RELAYS, [
  {
    authors: [PK],
    kinds: [1],
  },
]);

// 日時の降順にソートして、日ごとにグループ化する
const sortedPosts = [...posts].sort((a, b) => b.created_at - a.created_at);
const groupedPosts = sortedPosts.reduce((acc, obj) => {
  const date = new Date(obj.created_at * 1000);
  const key = date.toLocaleDateString();
  const curGroup = acc[key] ?? [];
  return { ...acc, [key]: [...curGroup, obj] };
}, {});

// HTML を作成する
const html =
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
      </style>
      <title>メモ</title>
    </head>
    <body class="markdown-body">
      <h1>メモ</h1>
` +
  Object.keys(groupedPosts)
    .map(
      (postDay) =>
        `      <h2>${postDay}</h2>
` +
        groupedPosts[postDay]
          .map((post) => {
            const date = new Date(post.created_at * 1000);
            const time = date.toLocaleTimeString();
            const content = marked.parse(post.content);
            return `      <h3>${time}</h3>
      <p>${content}</p>`;
          })
          .join("\n")
    )
    .join("\n") +
  `
    </body>
  </html>`;

// ファイルに出力する
fs.writeFileSync("index.html", html);

// await pool.close(RELAYS); // TypeError: Cannot read properties of undefined (reading 'sendCloseFrame')
process.exit(); // HACK: 強制終了する
