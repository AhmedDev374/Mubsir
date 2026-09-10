<script lang="ts">
	let { active = false }: { active?: boolean } = $props();
</script>

<span class="brand-logo" class:active aria-hidden="true">
	<img src="/voicebook-mark.svg" alt="" />
</span>

<style>
	.brand-logo {
		display: block;
		line-height: 0;
		transition: opacity 220ms var(--ease);
	}

.brand-logo img {
    width: 60px;
    height: 60px;
    display: block;
    object-fit: contain;
}

	.brand-logo.active {
		animation: brand-breathe 780ms var(--ease) infinite alternate;
	}

	@keyframes brand-breathe {
		from {
			opacity: 0.55;
			transform: scale(0.94);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>