using System.IO;
using System.Text.Json;

namespace CepHoras.Desktop;

internal static class ProtectedExitFeedback
{
    internal static string Refusal(string code) => code switch
    {
        "multiple_sessions" => "Há outra sessão do Windows aberta. A restauração dos controles exige revisão da TI.",
        "update_maintenance" => "Uma atualização está em andamento. Aguarde seu término antes de fechar.",
        "access_denied" => "O serviço recusou o acesso deste aplicativo. Solicite à TI a verificação da instalação.",
        "service_error" => "O serviço não conseguiu restaurar os controles. Mantenha o aplicativo aberto e solicite suporte à TI.",
        _ => "O serviço não confirmou a restauração dos controles. Mantenha o aplicativo aberto e solicite suporte à TI."
    };

    internal static string Failure(Exception error) => error switch
    {
        PowerBridgeFailure { Code: "power_recovery_required" or "power_uncertain" or "native_power_uncertain" } =>
            "Há uma ação de energia cujo cancelamento não foi confirmado. Abra o menu Energia, tente cancelar a ação e confira o Windows antes de fechar.",
        PowerBridgeFailure { Code: "power_service_changed" } =>
            "O serviço de energia mudou ou reiniciou. Solicite à TI a verificação do serviço antes de fechar.",
        OperationCanceledException or TimeoutException =>
            "O serviço de energia não respondeu dentro do prazo. O fechamento não foi confirmado. Confira o estado do aplicativo e solicite suporte à TI.",
        UnauthorizedAccessException => "Não foi possível validar o canal do serviço de energia. Solicite à TI a verificação da instalação.",
        InvalidDataException => "O serviço de energia retornou uma resposta inválida. Solicite suporte à TI.",
        IOException => "A comunicação com o serviço de energia foi interrompida. O fechamento não foi confirmado. Solicite suporte à TI.",
        JsonException => "O serviço de energia retornou uma resposta inválida. Solicite suporte à TI.",
        _ => "O fechamento falhou durante a preparação ou restauração dos controles. Mantenha o aplicativo aberto e solicite suporte à TI."
    };
}
