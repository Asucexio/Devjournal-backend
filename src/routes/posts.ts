import { Router, Request, Response, NextFunction } from "express";
import { supabase } from "../supabaseClient";
import { PostRow, IPost } from "../types";

const router = Router();

// ─── Helper: map DB row → frontend shape ─────────────────────────────────────

const mapPost = (row: PostRow): IPost => ({
  createdAt: row.created_at,
  post: row.post,
  date_string: row.date_string,
  date: row.date,
  post_link: row.post_link,
  PostTag: (row.PostTag ?? []).map((pt) => ({
    postId: pt.post_id,
    tagId: pt.tag_id,
    Tag: { id: pt.Tag.id, tag: pt.Tag.tag },
  })),
});

// ─── GET /posts?max=9 ─────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const max = Math.min(parseInt(req.query.max as string) || 9, 50); // cap at 50

    const { data, error } = await supabase
      .from("Post")
      .select(
        `
        id,
        post,
        post_link,
        date_string,
        date,
        created_at,
        PostTag (
          post_id,
          tag_id,
          Tag ( id, tag )
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(max);

    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "No posts available" });
    }

    res.json((data as unknown as PostRow[]).map(mapPost));
  } catch (err) {
    next(err);
  }
});

// ─── GET /posts/:id ───────────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const { data, error } = await supabase
      .from("Post")
      .select(
        `
        id,
        post,
        post_link,
        date_string,
        date,
        created_at,
        PostTag (
          post_id,
          tag_id,
          Tag ( id, tag )
        )
      `
      )
      .eq("id", id)
      .single();

    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    if (!data) return res.status(404).json({ error: "Post not found" });

    res.json(mapPost(data as unknown as PostRow));
  } catch (err) {
    next(err);
  }
});

// ─── POST /posts ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { post, post_link, date_string, date, tags } = req.body as {
      post: string;
      post_link?: string;
      date_string: string;
      date: string;
      tags?: string[]; // array of tag names
    };

    if (!post || !date_string || !date) {
      return res
        .status(400)
        .json({ error: "post, date_string, and date are required" });
    }

    // 1. Insert the post
    const { data: postData, error: postError } = await supabase
      .from("Post")
      .insert({ post, post_link: post_link ?? null, date_string, date })
      .select()
      .single();

    if (postError) throw Object.assign(new Error(postError.message), { statusCode: 500 });

    const newPostId: number = (postData as { id: number }).id;

    // 2. Resolve / create tags and link them
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;

        // Upsert tag
        const { data: tagData, error: tagError } = await supabase
          .from("Tag")
          .upsert({ tag: trimmed }, { onConflict: "tag" })
          .select()
          .single();

        if (tagError) throw Object.assign(new Error(tagError.message), { statusCode: 500 });

        const tagId: number = (tagData as { id: number }).id;

        // Link PostTag
        const { error: linkError } = await supabase
          .from("PostTag")
          .insert({ post_id: newPostId, tag_id: tagId });

        if (linkError) throw Object.assign(new Error(linkError.message), { statusCode: 500 });
      }
    }

    // 3. Return the full post with tags
    const { data: fullPost, error: fetchError } = await supabase
      .from("Post")
      .select(
        `
        id,
        post,
        post_link,
        date_string,
        date,
        created_at,
        PostTag (
          post_id,
          tag_id,
          Tag ( id, tag )
        )
      `
      )
      .eq("id", newPostId)
      .single();

    if (fetchError) throw Object.assign(new Error(fetchError.message), { statusCode: 500 });

    res.status(201).json(mapPost(fullPost as unknown as PostRow));
  } catch (err) {
    next(err);
  }
});

// ─── PUT /posts/:id ───────────────────────────────────────────────────────────

router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid post ID" });

    const { post, post_link, date_string, date, tags } = req.body as {
      post?: string;
      post_link?: string;
      date_string?: string;
      date?: string;
      tags?: string[];
    };

    // Update post fields (only what was provided)
    const updates: Record<string, unknown> = {};
    if (post !== undefined) updates.post = post;
    if (post_link !== undefined) updates.post_link = post_link;
    if (date_string !== undefined) updates.date_string = date_string;
    if (date !== undefined) updates.date = date;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from("Post").update(updates).eq("id", id);
      if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    }

    // Replace tags if provided
    if (tags !== undefined) {
      // Delete old links
      await supabase.from("PostTag").delete().eq("post_id", id);

      for (const tagName of tags) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;

        const { data: tagData, error: tagError } = await supabase
          .from("Tag")
          .upsert({ tag: trimmed }, { onConflict: "tag" })
          .select()
          .single();

        if (tagError) throw Object.assign(new Error(tagError.message), { statusCode: 500 });

        const tagId: number = (tagData as { id: number }).id;
        await supabase.from("PostTag").insert({ post_id: id, tag_id: tagId });
      }
    }

    // Return updated post
    const { data, error } = await supabase
      .from("Post")
      .select(
        `
        id, post, post_link, date_string, date, created_at,
        PostTag ( post_id, tag_id, Tag ( id, tag ) )
      `
      )
      .eq("id", id)
      .single();

    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    if (!data) return res.status(404).json({ error: "Post not found" });

    res.json(mapPost(data as unknown as PostRow));
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /posts/:id ────────────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid post ID" });

    // PostTag rows are deleted via ON DELETE CASCADE in the DB (see SQL schema)
    const { error } = await supabase.from("Post").delete().eq("id", id);
    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── GET /posts/tags/all ──────────────────────────────────────────────────────

router.get("/tags/all", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from("Tag")
      .select("id, tag")
      .order("tag", { ascending: true });

    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

export default router;
