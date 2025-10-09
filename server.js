const express = require('express');
const cors = require('cors');
const { sql, getPool } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('API Node.js para SQL Server está rodando!');
});


// Endpoint para consultar itens do pedido via REV_COD ou PED_COD
// NOTA: Este endpoint não precisa de alterações, pois a SP retorna os novos campos automaticamente
app.post('/api/sp-consulta-ipe-via-rev', async (req, res) => {
  try {
    const { REV_COD, PED_COD } = req.body;

    if ((REV_COD === undefined || REV_COD === null) && (PED_COD === undefined || PED_COD === null)) {
      return res.status(400).json({
        success: false,
        error: 'Pelo menos um dos parâmetros (REV_COD ou PED_COD) é obrigatório.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    const request = pool.request();

    if (PED_COD !== undefined && PED_COD !== null) {
      request.input('PED_COD', sql.Int, parseInt(PED_COD.toString() || '0'));
      console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para PED_COD: ${PED_COD}`);
    } else {
      request.input('REV_COD', sql.Int, parseInt(REV_COD.toString() || '0'));
      console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para REV_COD: ${REV_COD}`);
    }

    const result = await request.execute('sp_ConsultaIpeViaRev');

    console.log(`✅ [sp-ConsultaIpeViaRev] SP executada com sucesso. Registros: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [sp-ConsultaIpeViaRev] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao executar Stored Procedure. Detalhes: ' + error.message
    });
  }
});





// Endpoint para atualizar status de itens IPE ou inserir/deletar
// ATUALIZADO: INSERT sem CUP_TAM (campo não existe na CAD_IPE)
app.post('/api/atualizar-status-itens-ipe', async (req, res) => {
  try {
    const { itens } = req.body;

    // Log que mostra os itens INTEIROS que o server.js RECEBEU do Base44
    console.log('--- SERVER.JS RECEBEU ESTES ITENS DO BASE44 ---');
    console.log(JSON.stringify(itens, null, 2));
    console.log('--- FIM DO RECEBIMENTO ---');


    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'É necessário enviar um array de itens para sincronizar.'
      });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    let sincronizados = 0;
    let inseridos = 0;
    let deletados = 0;
    const itensInseridos = []; // Para armazenar IPE_COD gerados para o frontend
    const itensAtualizados = []; // Para armazenar IPE_COD de itens atualizados
    const itensDeletados = []; // Para armazenar IPE_COD de itens deletados

    // Loop principal para processar cada item
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];

      // Log detalhado de CADA ITEM dentro do loop
      console.log(`--- Processando item ${i} ---`);
      console.log(`  - Item.IPE_COD: ${item.IPE_COD}`);
      console.log(`  - Item.IPE_STA: ${item.IPE_STA}`);
      console.log(`  - Item.FORA_DO_PEDIDO: ${item.FORA_DO_PEDIDO}`);
      console.log(`  - Item.REV_COD: ${item.REV_COD}`); // Mantido para referência no log
      console.log(`  - Item.PED_COD: ${item.PED_COD}`); // Mantido para referência no log
      console.log(`  - Item.CUP_CDI: ${item.CUP_CDI}`); // Mantido para referência no log (não usado no INSERT/UPDATE no SQL Server)
      console.log(`  - Item.CUP_REF: ${item.CUP_REF}`); // Valor do frontend que vai para PRO_CDC
      console.log(`  - Item.IPE_DFP: ${item.IPE_DFP}`);
      console.log(`  - Item.IPE_DDV: ${item.IPE_DDV}`);
      console.log(`  - Item.USU_DEV: ${item.USU_DEV}`);
      console.log(`  - Item.CUP_COD: ${item.CUP_COD}`);
      console.log(`  - Item.UNI_COD: ${item.UNI_COD}`);
      console.log(`  - Item.REMARCADO_PROX_MES (do frontend): ${item.REMARCADO_PROX_MES}`); // Valor do frontend que vai para IPE_PPM
      console.log(`--- Fim do item ${i} ---`);


      try {
        const request = new sql.Request(transaction);

        // Cenário 1: Item FORA DO PEDIDO e IPE_STA = 1 (removido do local, precisa deletar do banco)
        if (item.FORA_DO_PEDIDO && item.IPE_STA === 1) {
          console.log(`  🗑️ DELETE: Item fora do pedido, IPE_STA=1 - Índice ${i}. IPE_COD: ${item.IPE_COD}`);
          if (item.IPE_COD) { // Só tenta deletar se tiver IPE_COD
            request.input('IPE_COD_DEL', sql.Int, item.IPE_COD);
            const deleteResult = await request.query(`
              DELETE FROM CAD_IPE WHERE IPE_COD = @IPE_COD_DEL;
            `);
            if (deleteResult.rowsAffected[0] > 0) {
              deletados++;
              itensDeletados.push({ IPE_COD: item.IPE_COD });
              console.log(`  ✅ DELETE efetuado para IPE_COD: ${item.IPE_COD}`);
            } else {
              console.log(`  ⚠️ DELETE não afetou linhas para IPE_COD: ${item.IPE_COD}. Talvez já tenha sido removido.`);
            }
          } else {
              console.log(`  ⚠️ DELETE ignorado para item sem IPE_COD: ${item.CUP_CDI}. (Item fora do pedido, removido antes de ser sincronizado).`);
          }
        }
        // Cenário 2: Item FORA DO PEDIDO e IPE_STA = 9 (novo item fora do pedido, precisa inserir)
        else if (item.FORA_DO_PEDIDO && item.IPE_STA === 9) {
          console.log(`  ➕ INSERT: Item fora do pedido - Índice ${i}`);
          
          // IPE_CODI fixo em 0 para não gerar erro de null
          request.input('IPE_CODI', sql.Int, 0); 
          // Usando PRO_QTD para atender a obrigatoriedade (assumindo que 1 é o valor padrão)
          request.input('PRO_QTD', sql.Int, 1);
          // Adicionado PRO_VAL e PRO_VNG, com o mesmo valor de IPE_VTL (valor do produto)
          request.input('PRO_VAL', sql.Decimal(10, 2), parseFloat(item.IPE_VTL));
          request.input('PRO_VNG', sql.Decimal(10, 2), parseFloat(item.IPE_VTL));

          // Campos que vêm do frontend, preparados para o INSERT
          request.input('PED_COD', sql.Int, parseInt(item.PED_COD));
          // `PRO_CDC` é o nome da coluna no banco, mas recebe o valor de `item.CUP_REF` do frontend
          request.input('PRO_CDC', sql.VarChar(50), String(item.CUP_REF)); 
          request.input('PRO_DES', sql.VarChar(255), String(item.PRO_DES));
          request.input('IPE_VTL', sql.Decimal(10, 2), parseFloat(item.IPE_VTL));
          request.input('IPE_STA', sql.Int, parseInt(item.IPE_STA));
          request.input('IPE_DFP', sql.Int, parseInt(item.IPE_DFP)); // Flag: 1 = fora do pedido
          request.input('IPE_DDV', sql.DateTime, new Date(item.IPE_DDV)); // Data/hora exata da devolução
          request.input('USU_DEV', sql.VarChar(50), String(item.USU_DEV)); // Usuário que fez a devolução
          request.input('CUP_COD', sql.VarChar(50), String(item.CUP_COD)); // Código do produto (pode ser NULL)
          request.input('UNI_COD', sql.VarChar(50), String(item.UNI_COD)); // Código da unidade (pode ser NULL)
          request.input('IPE_PPM', sql.Bit, item.REMARCADO_PROX_MES ? 1 : 0); // Campo 'Pedido Próximo Mês'

          const queryInsert = `
            INSERT INTO CAD_IPE (
              IPE_CODI, PRO_QTD, PED_COD, PRO_CDC, PRO_DES, IPE_VTL, IPE_STA,
              IPE_DFP, IPE_DDV, USU_DEV, CUP_COD, UNI_COD, IPE_PPM, PRO_VAL, PRO_VNG
            )
            OUTPUT INSERTED.IPE_COD
            VALUES (
              @IPE_CODI, @PRO_QTD, @PED_COD, @PRO_CDC, @PRO_DES, @IPE_VTL, @IPE_STA,
              @IPE_DFP, @IPE_DDV, @USU_DEV, @CUP_COD, @UNI_COD, @IPE_PPM, @PRO_VAL, @PRO_VNG
            );
          `;
          
          // Log da query SQL antes de ser executada
          console.log('  --- Query INSERT a ser executada ---');
          console.log(queryInsert);
          console.log('  --- Fim da Query INSERT ---');

          const result = await request.query(queryInsert);
          const insertedIpeCod = result.recordset[0].IPE_COD;
          itensInseridos.push({
            indice: i,
            IPE_COD: insertedIpeCod,
            CUP_CDI: item.CUP_CDI // Ainda retornamos CUP_CDI para o frontend se ele precisar identificar qual foi inserido
          });
          sincronizados++; // Incrementa sincronizados para inserções
        }
        // Cenário 3: Item DO PEDIDO e IPE_STA mudou (precisa atualizar status ou IPE_PPM)
        else if (!item.FORA_DO_PEDIDO && item.IPE_COD) {
          console.log(`  ✏️ UPDATE: Item do pedido, IPE_COD: ${item.IPE_COD} - Índice ${i}`);

          request.input('IPE_STA_UPDATE', sql.Int, parseInt(item.IPE_STA));
          request.input('IPE_COD_UPDATE', sql.Int, item.IPE_COD);
          request.input('IPE_DDV_UPDATE', sql.DateTime, item.IPE_DDV ? new Date(item.IPE_DDV) : null); // Update IPE_DDV
          request.input('USU_DEV_UPDATE', sql.VarChar(50), item.USU_DEV || null); // Update USU_DEV
          request.input('IPE_PPM_UPDATE', sql.Bit, item.REMARCADO_PROX_MES ? 1 : 0); // Update IPE_PPM

          const updateResult = await request.query(`
            UPDATE CAD_IPE
            SET 
              IPE_STA = @IPE_STA_UPDATE,
              IPE_DDV = @IPE_DDV_UPDATE,
              USU_DEV = @USU_DEV_UPDATE,
              IPE_PPM = @IPE_PPM_UPDATE
            WHERE IPE_COD = @IPE_COD_UPDATE;
          `);
          if (updateResult.rowsAffected[0] > 0) {
            sincronizados++;
            itensAtualizados.push({ IPE_COD: item.IPE_COD });
            console.log(`  ✅ UPDATE efetuado para IPE_COD: ${item.IPE_COD}`);
          } else {
            console.log(`  ⚠️ UPDATE não afetou linhas para IPE_COD: ${item.IPE_COD}. Item pode não existir ou status já é o mesmo.`);
          }
        } else {
          console.log(`  ⏩ IGNORADO: Item ${i} não se encaixa nos critérios de DELETE/INSERT/UPDATE.`);
        }

      } catch (itemError) {
        // Log específico para erro de um item, sem abortar toda a transação
        console.error(`❌ Erro ao processar item índice ${i}: ${itemError.message}`);
        // Você pode optar por continuar ou reverter tudo aqui.
        // Por enquanto, apenas logamos e permitimos que outros itens sejam processados.
        // Se quiser que um erro em um item aborte tudo, use `throw itemError;` aqui.
        // Mas o objetivo de uma transação é falhar ou ter sucesso atomicamente.
        // Para transações que processam múltiplos itens e podem ter falhas parciais:
        //  - Reverter a transação completa se qualquer item falhar: `throw itemError;`
        //  - Continuar e registrar falhas: Apenas logar e ir para o próximo item.
        //    (Mas a transação ainda seria um sucesso, a menos que haja um `throw`)
        // Para este caso, vamos reverter tudo se um item individual falhar:
        await transaction.rollback();
        console.error('❌ Transação revertida devido a erro em um item.');
        return res.status(500).json({
          success: false,
          error: `Erro ao sincronizar item ${i}`,
          details: itemError.message
        });
      }
    }

    await transaction.commit();
    console.log('✅ Transação concluída com sucesso!');

    res.status(200).json({
      success: true,
      message: 'Sincronização concluída com sucesso',
      sincronizados: sincronizados, // Itens atualizados e inseridos
      inseridos: itensInseridos.length,
      deletados: deletados,
      detalhes: {
        itensInseridos: itensInseridos,
        itensAtualizados: itensAtualizados,
        itensDeletados: itensDeletados
      }
    });

  } catch (error) {
    console.error('💥 ERRO GERAL NA FUNÇÃO syncIpeDevolucoes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});





// ENDPOINT: Para login de promotores
app.post('/api/login-promotor', async (req, res) => {
  try {
    const { cpf, senha } = req.body;

    if (!cpf || !senha) {
      return res.status(400).json({
        success: false,
        error: 'CPF e senha são obrigatórios.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`🔐 [login-promotor] Tentativa de login para CPF: ${cpf}`);

    const request = pool.request();
    request.input('CLI_DOC', sql.VarChar(14), cpf);
    request.input('SENHA_CLI_DOC', sql.VarChar(14), senha);

    const query = `
      SELECT CLI_COD, GRU_COD, CLI_RAZ, CLI_DOC
      FROM CAD_CLI
      WHERE CLI_DOC = @CLI_DOC
        AND CLI_DOC = @SENHA_CLI_DOC
        AND GRU_COD IN (2, 4)
        AND CLI_STA = 2;
    `;

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      const promotor = result.recordset[0];
      console.log(`✅ [login-promotor] Login bem-sucedido para: ${promotor.CLI_RAZ}`);
      res.json({
        success: true,
        message: 'Login bem-sucedido!',
        promotor: {
          CLI_COD: promotor.CLI_COD,
          GRU_COD: promotor.GRU_COD,
          CLI_RAZ: promotor.CLI_RAZ,
          CLI_DOC: promotor.CLI_DOD
        }
      });
    } else {
      console.log(`❌ [login-promotor] Credenciais inválidas para CPF: ${cpf}`);
      res.status(401).json({
        success: false,
        error: 'CPF ou senha inválidos, ou promotor não autorizado.'
      });
    }

  } catch (error) {
    console.error('❌ [login-promotor] Erro geral:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao tentar login. Detalhes: ' + error.message
    });
  }
});

// Endpoint para consultar produtos gerais (sp_returnCupDigitacao)
app.post('/api/consultar-produtos-gerais', async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`📦 [consultar-produtos-gerais] Executando sp_returnCupDigitacao com CTL_STA = 1`);

    const request = pool.request();
    request.input('CTL_STA', sql.Int, 1);

    const result = await request.execute('sp_returnCupDigitacao');

    console.log(`✅ [consultar-produtos-gerais] SP executada com sucesso. Produtos: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [consultar-produtos-gerais] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao consultar produtos gerais. Detalhes: ' + error.message
    });
  }
});

// ENDPOINT: Para listar acertos pendentes do promotor (Chamada da sp_CobrancaAcerto)
app.post('/api/listar-acertos-promotor', async (req, res) => {
  try {
    const { CLI_COD } = req.body;

    if (CLI_COD === undefined || CLI_COD === null) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro CLI_COD é obrigatório.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`📋 [listar-acertos-promotor] Executando sp_CobrancaAcerto para CLI_COD: ${CLI_COD}`);

    const request = pool.request();
    request.input('EMP_COD', sql.Int, 0);
    request.input('ATRASADO', sql.Bit, 0);
    request.input('RevCod', sql.Int, 0);
    request.input('TIPO', sql.Int, 4);
    request.input('EndCompleto', sql.Bit, 0);
    request.input('CliCod', sql.Int, CLI_COD);

    const result = await request.execute('sp_CobrancaAcerto');

    console.log(`✅ [listar-acertos-promotor] SP executada com sucesso. Acertos encontrados: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [listar-acertos-promotor] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao executar Stored Procedure sp_CobrancaAcerto. Detalhes: ' + error.message
    });
  }
});

// ENDPOINT: Consultar Regras de Desconto
app.post('/api/consultar-regras-desconto', async (req, res) => {
    try {
        const { PED_COD } = req.body;

        if (!PED_COD) {
            return res.status(400).json({
                success: false,
                error: 'PED_COD é obrigatório para consultar regras de desconto.'
            });
        }

        const pool = await getPool();
        if (!pool) {
            return res.status(500).json({
                success: false,
                error: 'Não foi possível conectar ao banco de dados.'
            });
        }

        const request = pool.request();
        request.input('PED_COD', sql.Int, parseInt(PED_COD));

        const query = `SELECT cad_dpd.PED_COD, 
                       cad_tdp.TDP_DES, 
	               cad_dpd.GRU_COD,
	               cad_dpd.DE,
	               cad_dpd.ATE,
	               cad_dpd.PORC,
	               cad_dpd.PORC_BONUS,
	               cad_dpd.PORC_CARENCIA,
	               cad_dpd.PORC_PERDA,
	               cad_dpd.QTDE_ACERTO_CARENCIA,
	               cad_dpd.DESC_VENDA_TOTAL
                       FROM 
                         cad_dpd
                       JOIN 
                         cad_tdp
                       ON 
                         cad_dpd.TDP_COD = cad_tdp.TDP_COD WHERE PED_COD = @PED_COD`;
        
        console.log(`📊 [consultar-regras-desconto] Consultando regras para PED_COD: ${PED_COD}`);
        
        const result = await request.query(query);

        console.log(`✅ [consultar-regras-desconto] Regras encontradas: ${result.recordset.length}`);

        res.json({
            success: true,
            data: result.recordset,
            total: result.recordset.length
        });

    } catch (error) {
        console.error('❌ [consultar-regras-desconto] Erro:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno ao consultar regras de desconto.',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});