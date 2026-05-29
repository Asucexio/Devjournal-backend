// ─── Database row shapes (match Supabase table columns) ───────────────────────

export interface TagRow {
  id: number;
  tag: string;
}

export interface PostTagRow {
  post_id: number;
  tag_id: number;
  Tag: TagRow;
}

export interface PostRow {
  id: number;
  post: string;
  post_link: string;
  date_string: string;
  date: string;
  created_at: string;
  PostTag: PostTagRow[];
}

// ─── API response shape (matches what the frontend expects) ───────────────────

export interface ITag {
  id: number;
  tag: string;
}

export interface IPostTag {
  postId: number;
  tagId: number;
  Tag: ITag;
}

export interface IPost {
  createdAt: string;
  post: string;
  date_string: string;
  date: string;
  post_link: string;
  PostTag: IPostTag[];
}
