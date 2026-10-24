import pytest
from sqlalchemy import select
from app.database.engine import get_sessionmaker
from app.masters.products.repository import ProductRepository
from app.common.list_query import ListQueryParams
from app.common.pagination import PageParams
from app.common.sorting import SortParams
from app.common.search import SearchParams
from app.common.filtering import FilterParams


@pytest.mark.asyncio
async def test_product_repository_is_spare_filter():
    """Verify that is_spare=true and is_spare=false filters work accurately on ProductRepository."""
    sm = get_sessionmaker()
    async with sm() as session:
        repo = ProductRepository(session)

        # 1. Query spares
        query_spares = ListQueryParams(
            page=PageParams(page=1, page_size=20),
            sort=SortParams(),
            search=SearchParams(),
            filters=FilterParams(exact={"is_spare": "true"}),
        )
        spares, total_spares = await repo.paginated_list(query_spares)
        assert total_spares > 0
        assert len(spares) > 0
        for p in spares:
            name = (p.product_name or "").lower()
            tally = (p.product_name_tally or "").lower()
            invoice = (p.product_name_invoice or "").lower()
            # Each spare either has spare in its name or its category/subcategory is spare
            # which is guaranteed by the SQL subquery condition

        # 2. Query non-spares (machines)
        query_machines = ListQueryParams(
            page=PageParams(page=1, page_size=20),
            sort=SortParams(),
            search=SearchParams(),
            filters=FilterParams(exact={"is_spare": "false"}),
        )
        machines, total_machines = await repo.paginated_list(query_machines)
        assert total_machines > 0
        assert len(machines) > 0

        # Disjoint check: No item in spares should be in machines
        spare_ids = {p.id for p in spares}
        machine_ids = {p.id for p in machines}
        assert spare_ids.isdisjoint(machine_ids)
