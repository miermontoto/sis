<script lang="ts">
  const generators = [
    {
      href: '/generators/album-quilt',
      icon: '▦',
      name: 'Album Quilt',
      description: 'NxN mosaic of your most-listened album covers. Downloadable as an image.',
    },
{
      href: '/generators/bubbles',
      icon: '◉',
      name: 'Bubbles',
      description: 'Bubble chart of your most-listened artists; bubble size represents play count.',
    },
    {
      href: '/generators/artist-velocity',
      icon: '∿',
      name: 'Artist Velocity',
      description: 'Cumulative play curves per artist. Compare multiple trajectories side by side.',
    },
    {
      href: '/generators/pie-chart',
      icon: '◔',
      name: 'Pie Chart',
      description: 'Distribution of your plays across top artists, with an Others slice for the long tail.',
    },
    {
      href: '/generators/receipt',
      icon: '▤',
      name: 'Receipt',
      description: 'Shopping-receipt poster of your top 10 tracks or artists, with estimated Spotify royalties.',
    },
{
      href: '/generators/race-chart',
      icon: '▶',
      name: 'Race Chart',
      description: 'Animated bar chart race showing how your top artists, tracks, or albums accumulate plays over time.',
    },
    {
      href: '/generators/march-madness',
      icon: '⑂',
      name: 'March Madness',
      description: 'Knockout bracket of your artists, tracks, or albums: seed the top ones or draw a random field, then pick your way to a champion.',
    },
  ];
</script>

<div class="page-header">
  <h1>Generators</h1>
  <p>Visual tools built on top of your listening history.</p>
</div>

<div class="generator-grid">
  {#each generators as g}
    <a href={g.href} class="generator-card">
      <div class="generator-icon">{g.icon}</div>
      <div class="generator-name">{g.name}</div>
      <div class="generator-desc">{g.description}</div>
    </a>
  {/each}
</div>

<style>
  .page-header p {
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .generator-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .generator-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    text-decoration: none;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: border-color 0.05s, transform 0.05s;
  }

  .generator-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .generator-icon {
    font-size: 2rem;
    line-height: 1;
    color: var(--accent);
  }

  .generator-name {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
  }

  .generator-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.4;
  }
</style>
