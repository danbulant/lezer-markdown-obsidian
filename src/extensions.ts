import { Input } from "@lezer/common";
import {
  BlockContext,
  Element,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
  parser as defParser,
  Strikethrough,
  Table,
} from "@lezer/markdown";

declare module "@lezer/markdown" {
  class BlockContext {
    readonly input: Input;
    checkedYaml: boolean | null;
  }
}

class FootnoteReferenceParser implements LeafBlockParser {
  constructor(private labelEnd: number) {}

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock) {
    if (isFootnoteRef(line.text) != -1) {
      return this.complete(cx, leaf);
    }
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    return this.complete(cx, leaf);
  }

  complete(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt(
        "FootnoteReference",
        leaf.start,
        leaf.start + leaf.content.length,
        [
          cx.elt("FootnoteMark", leaf.start, leaf.start + 2),
          cx.elt("FootnoteLabel", leaf.start + 2, this.labelEnd - 2),
          cx.elt("FootnoteMark", this.labelEnd - 2, this.labelEnd),
          ...cx.parser.parseInline(
            leaf.content.slice(this.labelEnd - leaf.start),
            this.labelEnd
          ),
        ]
      )
    );
    return true;
  }
}

export const Footnote: MarkdownConfig = {
  defineNodes: [
    "Footnote",
    "FootnoteLabel",
    "FootnoteMark",
    "FootnoteReference",
  ],
  parseInline: [
    {
      name: "Footnote",
      parse(cx: InlineContext, _: number, pos: number) {
        // typically [^1], but inside can match any characters but
        // square brackets and spaces.
        const match = /^\[\^[^\s[\]]+\]/.exec(cx.text.slice(pos - cx.offset));
        if (match) {
          const end = pos + match[0].length;
          return cx.addElement(
            cx.elt("Footnote", pos, end, [
              cx.elt("FootnoteMark", pos, pos + 2),
              cx.elt("FootnoteLabel", pos + 2, end - 1),
              cx.elt("FootnoteMark", end - 1, end),
            ])
          );
        }
        return -1;
      },
      before: "Link",
    },
  ],
  parseBlock: [
    {
      name: "FootnoteReference",
      leaf(cx: BlockContext, leaf: LeafBlock): LeafBlockParser | null {
        const ref = isFootnoteRef(leaf.content);
        if (ref != -1) {
          return new FootnoteReferenceParser(leaf.start + ref);
        }
        return null;
      },
      before: "LinkReference",
    },
  ],
};

function isFootnoteRef(content: string): number {
  const match = /^\[\^[^\s[\]]+\]:/.exec(content);
  return match ? match[0].length : -1;
}

const hashtagRE =
  /^[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+/;

export const Hashtag: MarkdownConfig = {
  defineNodes: ["Hashtag", "HashtagMark", "HashtagLabel"],
  parseInline: [
    {
      name: "Hashtag",
      parse(cx, next, pos) {
        if (next != 35 /* # */) {
          return -1;
        }
        const start = pos;
        pos += 1;
        const match = hashtagRE.exec(cx.text.slice(pos - cx.offset));
        if (match && /\D/.test(match[0])) {
          pos += match[0].length;
          return cx.addElement(
            cx.elt("Hashtag", start, pos, [
              cx.elt("HashtagMark", start, start + 1),
              cx.elt("HashtagLabel", start + 1, pos),
            ])
          );
        }
        return -1;
      },
    },
  ],
};

export const InternalLink: MarkdownConfig = {
  defineNodes: [
    "Embed",
    "EmbedMark",
    "InternalLink",
    "InternalMark",
    "InternalPath",
    "InternalSubpath",
    "InternalDisplay",
  ],
  parseInline: [
    {
      name: "InternalLink",
      parse(cx: InlineContext, _: number, pos: number) {
        const el = parseInternalLink(cx, pos);
        if (el) {
          return cx.addElement(el);
        }
        return -1;
      },
      before: "Link",
    },
    {
      name: "Embed",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next != 33) {
          return -1;
        }
        const link = parseInternalLink(cx, pos + 1);
        if (link) {
          const embedMark = cx.elt("EmbedMark", pos, pos + 1);
          return cx.addElement(
            cx.elt("Embed", pos, link.to, [embedMark, link])
          );
        }
        return -1;
      },
      before: "Image",
    },
  ],
};

function parseInternalLink(cx: InlineContext, pos: number): Element | null {
  if (
    cx.char(pos) != 91 /* [ */ ||
    cx.char(pos + 1) != 91 ||
    !isClosedLink(cx, pos)
  ) {
    return null;
  }
  const contents: Element[] = [];
  contents.push(cx.elt("InternalMark", pos, pos + 2));
  pos = cx.skipSpace(pos + 2);
  const path = parsePath(cx, pos - cx.offset, cx.offset);
  if (path) {
    contents.push(path);
    pos = cx.skipSpace(path.to);
  }
  const subpath = parseSubpath(cx, pos);
  if (subpath) {
    contents.push(subpath);
    pos = cx.skipSpace(subpath.to);
  }
  if (path == null && subpath == null) {
    return null;
  }
  if (cx.char(pos) == 124 /* | */) {
    contents.push(cx.elt("InternalMark", pos, pos + 1));
    pos += 1;
    const display = parseDisplay(cx, pos);
    if (display) {
      contents.push(display);
      pos = cx.skipSpace(display.to);
    }
  }
  contents.push(cx.elt("InternalMark", pos, pos + 2));
  return cx.elt(
    "InternalLink",
    contents[0].from,
    contents[contents.length - 1].to,
    contents
  );
}

function isClosedLink(cx: InlineContext, start: number): boolean {
  for (let pos = start + 2; pos < cx.end; pos++) {
    if (cx.char(pos) == 91 /* [ */ && cx.char(pos + 1) == 91) {
      return false;
    } else if (cx.char(pos) == 93 /* ] */ && cx.char(pos + 1) == 93) {
      // return false for empty
      // true otherwise
      return pos > start + 2;
    }
  }
  return false;
}

function parsePath(
  cx: InlineContext,
  start: number,
  offset: number
): Element | null {
  // anything but: |[]#^\/
  const match = /^[^[\]|#^\\/]+/.exec(cx.text.slice(start));
  if (match) {
    return cx.elt(
      "InternalPath",
      offset + start,
      offset + start + match[0].length
    );
  }
  return null;
}

function parseSubpath(cx: InlineContext, start: number): Element | null {
  if (cx.char(start) != 35 /* # */) {
    return null;
  }
  for (let pos = start + 1; pos < cx.end; pos++) {
    if (
      cx.char(pos) == 124 /* | */ ||
      (cx.char(pos) == 93 /* ] */ && cx.char(pos + 1) == 93)
    ) {
      return cx.elt("InternalSubpath", start, pos);
    }
  }
  return null;
}

function parseDisplay(cx: InlineContext, start: number): Element | null {
  for (let pos = start; pos < cx.end; pos++) {
    if (cx.char(pos) == 93 /* ] */ && cx.char(pos + 1) == 93) {
      if (pos == start) {
        return null;
      }
      return cx.elt("InternalDisplay", start, pos);
    }
  }
  return null;
}

/*
  Copyright (C) 2020 by Marijn Haverbeke <marijnh@gmail.com> and others
  https://github.com/lezer-parser/markdown/blob/f49eb8c8c82cfe45aa213ca1fe2cebc95305b88b/LICENSE
*/
class TaskParser implements LeafBlockParser {
  nextLine() {
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("TaskMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ])
    );
    return true;
  }
}

/// Extension providing
/// [GFM-style](https://github.github.com/gfm/#task-list-items-extension-)
/// task list items, where list items can be prefixed with `[ ]` or
/// `[x]` to add a checkbox.
/// `x` can be any character
export const TaskList: MarkdownConfig = {
  defineNodes: [{ name: "Task", block: true }, "TaskMarker"],
  parseBlock: [
    {
      name: "TaskList",
      leaf(cx, leaf) {
        return /^\[.\]/.test(leaf.content) && cx.parentType().name == "ListItem"
          ? new TaskParser()
          : null;
      },
      after: "SetextHeading",
    },
  ],
};
/* End Copyright */

export const YAMLFrontMatter: MarkdownConfig = {
  defineNodes: ["YAMLFrontMatter", "YAMLMarker", "YAMLContent"],
  parseBlock: [
    {
      name: "YAMLFrontMatter",
      parse(cx, line) {
        if (cx.checkedYaml) {
          return false;
        }
        cx.checkedYaml = true;
        const fmRegex = /(^|^\s*\n)(---\n.+?\n---)/s;
        const match = fmRegex.exec(cx.input.chunk(0));
        if (match) {
          const start = match[1].length;
          const end = start + match[2].length;
          cx.addElement(
            cx.elt("YAMLFrontMatter", start, end, [
              cx.elt("YAMLMarker", start, start + 3),
              cx.elt("YAMLContent", start + 4, end - 4),
              cx.elt("YAMLMarker", end - 3, end),
            ])
          );
          while (cx.lineStart + line.text.length < end && cx.nextLine()) {}
          line.pos = 3;
          return true;
        }
        return false;
      },
      before: "LinkReference",
    },
  ],
};

export const ObsidianMDExtensions = [
  Footnote,
  Hashtag,
  InternalLink,
  Strikethrough,
  Table,
  TaskList,
  YAMLFrontMatter,
];

export const parser = defParser.configure(ObsidianMDExtensions);
