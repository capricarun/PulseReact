import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import ComposeBox from '../components/ComposeBox.jsx';
import PostCard from '../components/PostCard.jsx';

export default function Feed() {
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPage) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getFeed(nextPage);
      setPosts((prev) => (nextPage === 1 ? data.posts : [...prev, ...data.posts]));
      setHasMore(data.posts.length === data.pageSize);
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  function handlePosted(post) {
    setPosts((prev) => [post, ...prev]);
  }

  return (
    <div className="feed">
      <div className="feed-header">
        <h1>Right now (v2 on EKS)</h1>
        <p>Every post, newest first — no algorithm between you and the moment.</p>
      </div>

      <ComposeBox onPosted={handlePosted} />

      {error && <p className="form-error">{error}</p>}

      <div className="feed-stream">
        {posts.map((post, i) => (
          <PostCard key={post.id} post={post} isLast={i === posts.length - 1} />
        ))}
        {!loading && posts.length === 0 && !error && (
          <div className="empty-state">
            <p>Nothing here yet. Be the first to post.</p>
          </div>
        )}
      </div>

      {hasMore && posts.length > 0 && (
        <button className="btn btn-ghost load-more" onClick={() => load(page + 1)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
