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
    import uuid
    from sqlalchemy import delete
    from app.masters.product_categories.models import ProductCategory
    from app.masters.products.models import Product
    from app.masters.uom.models import UnitOfMeasurement

    sm = get_sessionmaker()
    created_product_ids: list[uuid.UUID] = []
    async with sm() as session:
        try:
            spare_cat = ProductCategory(name=f"Spare Parts-{uuid.uuid4().hex[:4]}", code=f"SP-{uuid.uuid4().hex[:4]}")
            machine_cat = ProductCategory(name=f"Packaging Machines-{uuid.uuid4().hex[:4]}", code=f"MC-{uuid.uuid4().hex[:4]}")
            session.add_all([spare_cat, machine_cat])
            await session.flush()

            uom = (await session.execute(select(UnitOfMeasurement).limit(1))).scalars().first()
            if uom is None:
                uom = UnitOfMeasurement(name=f"Pieces-{uuid.uuid4().hex[:4]}", code=f"PC{uuid.uuid4().hex[:3].upper()}")
                session.add(uom)
                await session.flush()

            spare_prod = Product(
                product_code=f"SP-{uuid.uuid4().hex[:6].upper()}",
                product_name="Heating Element Spare Part",
                product_name_tally="Heating Element Spare Part",
                category_id=spare_cat.id,
                uom_id=uom.id,
            )
            machine_prod = Product(
                product_code=f"MC-{uuid.uuid4().hex[:6].upper()}",
                product_name="Automatic Carton Sealer Machine",
                product_name_tally="Automatic Carton Sealer Machine",
                category_id=machine_cat.id,
                uom_id=uom.id,
            )
            session.add_all([spare_prod, machine_prod])
            await session.flush()
            created_product_ids.extend([spare_prod.id, machine_prod.id])

            repo = ProductRepository(session)

            # 1. Query spares
            query_spares = ListQueryParams(
                page=PageParams(page=1, page_size=50),
                sort=SortParams(),
                search=SearchParams(),
                filters=FilterParams(exact={"is_spare": "true"}),
            )
            spares, total_spares = await repo.paginated_list(query_spares)
            assert total_spares > 0
            assert len(spares) > 0
            spare_ids = {p.id for p in spares}
            assert spare_prod.id in spare_ids

            # 2. Query non-spares (machines)
            query_machines = ListQueryParams(
                page=PageParams(page=1, page_size=50),
                sort=SortParams(),
                search=SearchParams(),
                filters=FilterParams(exact={"is_spare": "false"}),
            )
            machines, total_machines = await repo.paginated_list(query_machines)
            assert total_machines > 0
            assert len(machines) > 0
            machine_ids = {p.id for p in machines}
            assert machine_prod.id in machine_ids

            # Disjoint check: No item in spares should be in machines
            assert spare_ids.isdisjoint(machine_ids)
        finally:
            await session.rollback()
            if created_product_ids:
                async with sm() as clean:
                    await clean.execute(delete(Product).where(Product.id.in_(created_product_ids)))
                    await clean.commit()
